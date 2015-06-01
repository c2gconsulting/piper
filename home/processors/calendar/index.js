var EventEmitter = require('events').EventEmitter;
var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var utils = require('../../../shared/lib/utils');
var scheduler = require('../../../shared/lib/scheduler');
var User = require('../../../shared/models/User');
var gapps = require('./lib/gapps');
var responses = require('./dict/responses');
var when = require('when');
var _ = require('underscore');
CACHE_PREFIX = 'calendar_events:';
var CONTEXT_TTL = 900;

cache.on("error", function(err){
    logger.error("Redis Error: " + err)
});
function Calendar(data){
    EventEmitter.call(this);
    this.pub = mq.context.socket('PUB', {routing: 'topic'});
    this.sub = mq.context.socket('SUB', {routing: 'topic'});
    this.msgid = new Date().getTime();
    var me = this;
    //define handler keys
    this.handlerKeys = {
        'calendar_get_events': [
            "event_date"
        ]
    };
    this.validations = {
        'event_date': [
            function (d, b, i) {
                if(i.datetime_from){
                    return true ;
                } else {
                    d.event_date = false;
                    return false;
                }
            }
        ]
    };
    this.response = {
        'event_date' : function(user, clientHandle, data) {
            var responseText = getResponse(data, 'NO_EVENT_DATE');

            responseText = responseText.replace("@username", user.name);
            me.emit('message', Calendar.MODULE, user.name, clientHandle, responseText);
            return false;
            return false;
        }
    };
    this.handleRequest = {
        'calendar_get_events': function (username, clientHandle, data) {
            logger.debug('the data for handleRequest' + JSON.stringify(data));
            // Process the entire method for getting events and the emit message ;
            // first check if user has been authorised
            if(username && clientHandle) gapps.authorize(username, clientHandle)
                .then(function(result){
                   checkResult(username, clientHandle, result, data).then(function(responseText){
                       me.emit('message', Calendar.MODULE, username, clientHandle, responseText);
                       return true;
                   }, function(err){
                       logger.debug('An fatal error occured ' + err);
                   });
                }, function(err){
                    logger.error('An Error occured ' + err);
                });
        }
    }
}

Calendar.prototype = Object.create(EventEmitter.prototype);
Calendar.prototype.constructor = Calendar;
Calendar.MODULE = 'CALENDAR';

Calendar.prototype.init = function(){
    // subscribe to inbound MQ exchange
    logger.info('%s Processor: Connecting to MQ Exchange <piper.events.in>...', Calendar.MODULE);
    this.sub.connect('piper.events.in', Calendar.MODULE.toLowerCase(), function() {
        logger.info('%s Processor: <piper.events.in> connected', Calendar.MODULE);
    });
    var me = this;
    this.sub.on('data', function(data) {
        var jsonData = JSON.parse(data);
        if (data) me.in(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
    });

};

function getUserKey(username, clientHandle) {
    return CACHE_PREFIX + username + '@' + clientHandle;
}

/**
 * Receive a message for processing from the front-end
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Calendar.prototype.out = function(user, client, body) {
    var me = this;
    checkActiveSession(user.name, client.slackHandle).then(function(activeSession) {
        if (body.outcomes[0].intent === 'calendar_get_events') {
            var handlerTodo = 'calendar_get_events';
            body.touch = true;  // confirms the statement is understood
        }

        logger.debug('Calendar.HandlerTodo->First Cut: %s', handlerTodo);

        if (handlerTodo === 'calendar_get_events') body.touch = true; // understood

        logger.debug('Body Touched?: %s', body.touch);

        me.processData(user, client.slackHandle, body, handlerTodo);

    });
};

Calendar.prototype.in = function(msgid, username, clientHandle, body) {
    var me = this;
    // check for message uniqueness
    if (this.msgid !== msgid) {
        //call Calendar.prototype.out and reprocess message if body is not nil
        if(body){
            me.handleRequest['calendar_get_events'](username, clientHandle, body);
        } else {
            me.emit('message', Calendar.MODULE, username, clientHandle, 'Google Authorization completed successfully');
        }
    }

}


function checkActiveSession(username, clientHandle) {
    var userkey = getUserKey(username, clientHandle);
    return cache.hgetall(userkey + ':payload').then(function(request) {
        if (!request) {
            return false;
        } else {
            return true;
        }
    });
}

Calendar.prototype.processData = function(user, clientHandle, body, handlerTodo) {
    var me = this;
    var username = user.name;
    var userkey = getUserKey(username, clientHandle);

    var indata = extractEntities(body);
    indata.hasActiveSession = checkActiveSession(username, clientHandle);

    if (body.outcomes) {
        if (body.outcomes[0].intent === 'default_accept') indata.yes_no = 'yes';
        if (body.outcomes[0].intent === 'default_reject') indata.yes_no = 'no';
    }

    body.user = user;
    body.clientHandle = clientHandle;



    cache.exists(userkey + ':datacheck').then(function (check) {
        var datakeys = me.handlerKeys[handlerTodo];
        if (check === 0 && datakeys && datakeys.length > 0) {
            // new request: initialize datacheck set with entity list
            for (var d=0; d<datakeys.length; d++) {
                cache.zadd(userkey + ':datacheck', d, datakeys[d]);
            }
        }

        cache.hgetall(userkey + ':payload').then(function(datahash) {
            if (!datahash) {
                datahash = { 'handlerTodo' : handlerTodo};

                body.restart = true;
            } else {
                datahash.handlerTodo = handlerTodo;
            }
            // checking set datahash entities to indata
            if (body.outcomes) datahash.intent = body.outcomes[0].intent;
            if (datahash.lvlQueries) {
                try {
                    datahash.lvlQueries = JSON.parse(datahash.lvlQueries);
                } catch(e) {
                    datahash.lvlQueries = {};
                }
            }

            var datacheckPromises = [],
                validationPromisesFn = [],
                fvPromises = [];

            for (var i=0; i<datakeys.length; i++) {
                validationPromisesFn[i] = [];
                for (var f=0; f<me.validations[datakeys[i]].length; f++) {
                    validationPromisesFn[i][f] = when.lift(me.validations[datakeys[i]][f]);
                }
            }

            var step = -1;
            when.unfold(function(validationPromisesFn) {
                step++;
                var vPromises = [];
                for (var f=0; f<me.validations[datakeys[step]].length; f++) {
                    vPromises[f] = validationPromisesFn[0][f](datahash, body, indata);
                }
                return [vPromises, validationPromisesFn.slice(1)];
            }, function(remaining) {
                logger.debug('Validation Predicate: ' + remaining.length);
                return remaining.length < 1;
            }, function(validationPromises) {
                for (var f=0; f<validationPromises.length; f++) {
                    (function (_i, _f) {
                        validationPromises[_f].then(function (ret) {
                            logger.debug('%s: %s -> %s | b.touch: %s', datakeys[_i], _f, ret, body.touch);
                        });
                    } (step, f));
                }
                return fvPromises[step] = when.reduce(validationPromises, function (validAgg, value, index) {
                    return validAgg || value;
                }, false);

            }, validationPromisesFn).done(function(){
                when.all(fvPromises).then(function(validityChecks) {
                    for (var i=0; i<validityChecks.length; i++) {
                        logger.debug('Datakey: %s, Validity Check: %s', datakeys[i], validityChecks[i]);

                        if (validityChecks[i]) {
                            datacheckPromises[i] = cache.zrem(userkey + ':datacheck', datakeys[i]); // remove from datacheck if valid
                        } else {
                            datacheckPromises[i] = cache.zadd(userkey + ':datacheck', i, datakeys[i]); // add to datacheck if not valid (leave in datahash)
                        }
                    }

                    var doResponse = true;
                    if (!body.touch && me.failover[handlerTodo]) doResponse = me.failover[handlerTodo](user, clientHandle, indata, datahash); // process failover if statement not understood
                    logger.debug('Datahash: %s', JSON.stringify(datahash));
                    logger.debug('Indata: %s', JSON.stringify(indata));

                    if (doResponse) {
                        when.all(datacheckPromises).then(function() {
                            cache.zrange(userkey + ':datacheck', 0, -1).then(function(missingKeys) {
                                var missingData = false;
                                var stop = false;
                                var count = 0;
                                var pResponses = [];
                                var currMissingKeys = [];

                                if (missingKeys.length > 0 && datakeys && datakeys.length > 0) {
                                    for (var k=0; k<missingKeys.length; k++) {
                                        if (me.handlerKeys[handlerTodo].indexOf(missingKeys[k]) > -1) {
                                            missingData = true;
                                            pResponses[count] = when.lift(me.response[missingKeys[k]]);
                                            currMissingKeys[count] = missingKeys[k];
                                            count++;
                                        }
                                    }

                                    logger.debug('Missing Keys for %s: %s', handlerTodo, JSON.stringify(currMissingKeys));
                                }

                                when.unfold(function(pResponses) {
                                    logger.debug('Datahash from unfold: %s', JSON.stringify(datahash));
                                    return [pResponses[0](user, clientHandle, datahash), pResponses.slice(1)];
                                }, function(remaining) {
                                    // Stop when all done or return value is true
                                    logger.debug('Response Predicate: ' + remaining.length);
                                    return remaining.length < 1 || stop;
                                }, function(proceed) {
                                    if (!proceed) stop = true;
                                }, pResponses).done(function(){

                                    logger.debug('Body: %s', JSON.stringify(body));
                                    logger.debug('Indata: %s', JSON.stringify(indata));

                                    logger.debug(userkey);
                                    if (datahash.lvlQueries) logger.debug('Datahash.lvlQueries: %s', JSON.stringify(datahash.lvlQueries));
                                    datahash.lvlQueries = JSON.stringify(datahash.lvlQueries);
                                    cache.del(userkey + ':payload').then (function(){
                                        cache.hmset(userkey + ':payload', datahash).then(function(){
                                            cache.expire(userkey + ':payload', CONTEXT_TTL);
                                            cache.expire(userkey + ':datacheck', CONTEXT_TTL);
                                            if (!missingData && body.touch) {
                                                // data is complete and valid
                                                logger.debug('No more missing data: calling handleRequest for %s', handlerTodo);
                                                me.handleRequest[handlerTodo](user.name, clientHandle, datahash);

                                            }
                                        });
                                    });

                                });
                            });
                        });
                    }
                });
            });
        });

    });
};
/*
@user : user
@clientHandle : clientHandle
@obj : returned result from gapps.authorize... this could be a string(auth url) or an oauth object
@data : data to be processed// if user is authorized then process data else save and process data after authorization
        no need to allow user repeat the last question / message;
 */
function checkResult(user, clientHandle, obj, data){
    var responseText;
    if(typeof(obj) === 'object'){
        logger.debug(JSON.stringify(data) + 'Data returned');
        //already authorized... call get events
      return gapps.getEvents(obj).then(function(events){
          var lists = events.items;
            if(lists.length == 0){
                return 'You have no upcoming event for today';
            } else {
                var message = 'Here are some of your calendar events';
                for (var i=0; i < lists.length; i++) {
                    message +=  '\n>• ' + lists[i].summary + '--'  + lists[i].start.dateTime || lists[i].start.date;
                }
                return message;
            }
        }, function(err){
            logger.debug("An error occured %s", err);
        })
    } else {
        return new Promise(function(resolve, reject){
            try{
                responseText = responses['default_authorization'][_.random(responses['default_authorization'].length)];
                responseText = responseText.replace("@authUrl", obj);
                //since user has no active authorization, save data for later processing
                var userkey = getUserKey(user, clientHandle);
                cache.hset(userkey + ':lastMessage', 'data', JSON.stringify(data)).then(function(stat){
                    if(stat) logger.debug('last Message in memory for processing after authorization');
                }, function(err){
                    logger.error('An Error occured while capturing last message' + err);
                });
                resolve(responseText);
            } catch(e){
                reject(e);
            }
        });

    }
}

function extractEntities(body) {
    var indata = {};
    var entities = {};
    if (body.outcomes) entities = body.outcomes[0].entities;
    var eKeys = Object.keys(entities);

    logger.debug('Entities: %s', JSON.stringify(entities));

    if (eKeys) {
        for (var e=0; e<eKeys.length; e++) {
            if (entities[eKeys[e]][0].grain !== 'day') indata[eKeys[e]] = entities[eKeys[e]][0].value;
            if (entities[eKeys[e]][0].to) indata[eKeys[e] + '_to'] = entities[eKeys[e]][0].to.value;
            if (entities[eKeys[e]][0].from) indata[eKeys[e] + '_from'] = entities[eKeys[e]][0].from.value;
            if (entities[eKeys[e]][0].grain === 'day') indata[eKeys[e] + '_from'] = entities[eKeys[e]][0].value;

            if (entities[eKeys[e]][1]) {
                if (entities[eKeys[e]][1].grain !== 'day') indata[eKeys[e]] = entities[eKeys[e]][1].value;
                if (entities[eKeys[e]][1].to) indata[eKeys[e] + '_to'] = entities[eKeys[e]][1].to.value;
                if (entities[eKeys[e]][1].from) indata[eKeys[e] + '_from'] = entities[eKeys[e]][1].from.value;
                if (entities[eKeys[e]][1].grain === 'day') indata[eKeys[e] + '_from'] = entities[eKeys[e]][1].value;
            }
        }
    }
    logger.debug(JSON.stringify(indata));
    return indata;

}
function getResponse(data, errorMsg) {
    if (!data.lvlQueries) data.lvlQueries = {};
    if (!data.lvlQueries[errorMsg] || isNaN(data.lvlQueries[errorMsg])) data.lvlQueries[errorMsg] = 0;
    while (!responses[errorMsg][data.lvlQueries[errorMsg]] && data.lvlQueries[errorMsg] > 0) data.lvlQueries[errorMsg]--;

    var responseText = responses[errorMsg][data.lvlQueries[errorMsg]] ? responses[errorMsg][data.lvlQueries[errorMsg]] : "I'm a bit confused...";
    data.lvlQueries[errorMsg]++;
    return responseText;
}

module.exports = Calendar;