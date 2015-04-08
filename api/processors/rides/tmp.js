var EventEmitter = require('events').EventEmitter

var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var utils = require('../../../shared/lib/utils');
var responses = require('./responses.json');
var when = require('when');

var CACHE_PREFIX = 'rides:';
var MSGKEYS_TTL = 300;
	
cache.on("error", function (err) {
    logger.error("Redis Error: " + err);
});


function Rides(data) {
	EventEmitter.call(this);
	this.pub = mq.context.socket('PUB', {routing: 'topic'});
	this.sub = mq.context.socket('SUB', {routing: 'topic'});
	this.msgid = new Date().getTime();
	var me = this;

	this.handlerKeys = {
		'rides_book_trip' : [
						'confirmNeed',
						'startLong',
						'startLat',
						'carrier',
						'endAddress',
						'departureTime',
						'confirmRequest'
					]
	};

	this.validations = {
		'confirmNeed' : [
						function(d, e) {
							if (d.intent !== 'rides_go_out' && d.intent !== 'rides_confirm_ride_needed') {
								d.confirmNeed = d.valid = true;
								return d;
							}
							if (d.confirmNeed === 'on' || d.confirmNeed === true) {
								d.confirmNeed = d.valid = true;
								return d;
							}
							if (d.confirmNeed === 'off' || d.confirmNeed === false) {
								d.confirmNeed = false;
								d.valid = true;
								return d;
							}
							d.valid = false;
							return d;
						}
					],
		'startLong' : [
						function(d, e) {
							if (!d.startLong || d.startLong === 0) {
								d.valid = false;
								return d;
							}
							d.valid = true;
							return d;
						}
					],
		'startLat' 	: [
						function(d, e) {
							if (!d.startLat || d.startLat === 0) {
								d.valid = false;
								return d;
							}
							d.valid = true;
							return d;
						}
					],
		'carrier' 	: [
						function(d, e) {
							d.valid = true;
							return d;
						}
					],
		'endAddress': [
						function(d, e) {
							d.valid = true;
							return d;
						}
					],
		'departureTime': [
						function(d, e) {
							d.valid = true;
							return d;
						}
					],
		'confirmRequest' : [
						function(d, e) {
							if (d.confirmRequest === false || d.confirmRequest === 'off') {
								d.confirmRequest = false;
								d.valid = true;
								return d;
							}
							if (d.confirmRequest === 'on' || d.confirmRequest === true) {
								d.confirmRequest = true;
								d.valid = true;
								return d;
							}
							d.valid = false
							return d;
						}
					]

	};

	this.response = {
		'confirmNeed' : function(username, clientHandle, data) {
						data.lvlConfirmNeedQueries = data.lvlConfirmNeedQueries ? data.lvlConfirmNeedQueries + 1 : 0;
						while (!responses.confirmNeed[data.lvlConfirmNeedQueries] && data.lvlConfirmNeedQueries > 0) data.lvlConfirmNeedQueries--;
						var responseText = responses.confirmNeed[data.lvlConfirmNeedQueries] ? responses.confirmNeed[data.lvlConfirmNeedQueries] : "I'm a bit confused..."; 
						
						me.emit('message', Rides.MODULE, username, clientHandle, responseText, Rides.MODULE + "_confirm_ride_needed");
						data.proceed = false;
						return data
					},	
		'startLong' : function(username, clientHandle, data) {
						data.lvlLocationQueries = data.lvlLocationQueries ? data.lvlLocationQueries + 1 : 0;
						while (!responses.location[data.lvlLocationQueries] && data.lvlLocationQueries > 0) data.lvlLocationQueries--;
						var responseText = responses.location[data.lvlLocationQueries] ? responses.location[data.lvlLocationQueries].replace("@locationlink", getLocationLink()) : "I'm a bit confused..."; 
						
						me.emit('message', Rides.MODULE, username, clientHandle, responseText, Rides.MODULE + "_get_location");
						data.proceed = false;
						return data
					},
		'startLat' 	: function(username, clientHandle, data) {
						data.lvlLocationQueries = data.lvlLocationQueries ? data.lvlLocationQueries + 1 : 0;
						while (!responses.location[data.lvlLocationQueries] && data.lvlLocationQueries > 0) data.lvlLocationQueries--;
						var responseText = responses.location[data.lvlLocationQueries] ? responses.location[data.lvlLocationQueries].replace("@locationlink", getLocationLink()) : "I'm a bit confused..."; 
						
						me.emit('message', Rides.MODULE, username, clientHandle, responseText, Rides.MODULE + "_get_location");
						data.proceed = false;
						return data
					},
		'carrier' 	: function(username, clientHandle, data) {
						if (data.preferredCarrier) {
							data.lvlCarrierQueries = data.lvlCarrierQueries ? data.lvlCarrierQueries + 1 : 0;
							while (!responses.carrier[data.lvlCarrierQueries] && data.lvlCarrierQueries > 0) data.lvlCarrierQueries--;
							var responseText = responses.carrier[data.lvlCarrierQueries] ? responses.carrier[data.lvlCarrierQueries].replace("@preferredCarrier", data.preferredCarrier) : "I'm a bit confused..."; 
							
							me.emit('message', Rides.MODULE, username, clientHandle, responseText, Rides.MODULE + "_confirm_carrier");
						} 
						data.proceed = false;
						return data
					},
		'endAddress': function(username, clientHandle, data) {
						data.proceed = true;
						return data
					},
		'departureTime' : function(username, clientHandle, data) {
						data.proceed = true;
						return data
					},
		'confirmRequest' : function(username, clientHandle, data) {
						data.lvlConfirmRequestQueries = data.lvlConfirmRequestQueries ? data.lvlConfirmRequestQueries + 1 : 0;
						while (!responses.confirmRequest[data.lvlConfirmRequestQueries] && data.lvlConfirmRequestQueries > 0) data.lvlConfirmRequestQueries--;
						var responseText = responses.confirmRequest[data.lvlConfirmRequestQueries] ? responses.confirmRequest[data.lvlConfirmRequestQueries].replace("@username", username) : "I'm a bit confused..."; 
						
						me.emit('message', Rides.MODULE, username, clientHandle, responseText, Rides.MODULE + "_confirm_request");
						data.proceed = false;
						return data
					}			
					
	};

}

Rides.prototype = Object.create(EventEmitter.prototype);
Rides.prototype.constructor = Rides;
Rides.MODULE = 'RIDES';

Rides.prototype.init = function(){
	// subscribe to inbound MQ exchange
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.in>...', Rides.MODULE);
	this.sub.connect('piper.events.in', Rides.MODULE.toLowerCase(), function() {
		logger.info('%s Processor: <piper.events.in> connected', Rides.MODULE);
	});
	var me = this;
	this.sub.on('data', function(data) {
		jsonData = JSON.parse(data);
		if (data) me.in(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
	});

}

/**
 * Receive a message for processing from the front-end
 * @param username - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.out = function(username, client, body) {
	var handlerTodo = '';
	
	switch(body.outcomes[0].intent) {
        case "rides_cancel_trip":
            // cancel existing trip 
            handlerTodo = body.outcomes[0].intent;
            break;
        case "rides_request_price_estimate":
            // retrieve price for products available to user
            handlerTodo = body.outcomes[0].intent;
            break;
        case "rides_request_eta":
        	// retrieve ETA for user ride
            handlerTodo = body.outcomes[0].intent;
            break;
        default:
            handlerTodo = "rides_book_trip";

  	}
            
    this.processData(username, client, body, handlerTodo);

}


/**
 * Validate data sufficiency and trigger request to endpoint
 * @param username - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.processData = function(username, client, body, handlerTodo) {
    var me = this;
    var clientHandle = client.slackHandle;
	var userkey = CACHE_PREFIX + username + '@' + clientHandle;
	

	// check if this is a new request from the user
	cache.exists(userkey + ':datacheck').then(function (check) {
		var datakeys = me.handlerKeys[handlerTodo];
		if (check === 0 && datakeys && datakeys.length > 0) {
			// new request: initialize datacheck set with entity list
			for (var d=0; d<datakeys.length; d++) {
				cache.zadd(userkey + ':datacheck', d, datakeys[d]);
			}
		}

		// extract data from body
		var indata = { 'handlerTodo' : handlerTodo };
		var entities = body.outcomes[0].entities;
		var eKeys = Object.keys(entities);

		logger.debug('Entities: %s', JSON.stringify(entities));

		if (eKeys) {
			for (var e=0; e<eKeys.length; e++) {
				indata[eKeys[e]] = entities[eKeys[e]][0].value;
			}
		}

		logger.info('indata: ' + JSON.stringify(indata));

		cache.hmset(userkey + ':payload', indata).then(function(value) {
			// load back full hash and validate fields
			cache.hgetall(userkey + ':payload').then(function(datahash) {
				datahash.handlerTodo = handlerTodo;
				datahash.intent = body.outcomes[0].intent;

				var datacheckPromises = [];
				for (var i=0; i<datakeys.length; i++) {
					var fieldValid = true;
					for (var f=0; f<me.validations[datakeys[i]].length; f++) {
						datahash = me.validations[datakeys[i]][f](datahash, entities);
						fieldValid = fieldValid && datahash.valid;
					}

					if (fieldValid) {
						datacheckPromises[i] = cache.zrem(userkey + ':datacheck', datakeys[i]); // remove from datacheck if valid
					} else {
						datacheckPromises[i] = cache.zadd(userkey + ':datacheck', i, datakeys[i]); // add to datacheck if not valid (leave in datahash)
					}
				}

				when.all(datacheckPromises).then(function() {
					cache.zrange(userkey + ':datacheck', 0, -1).then(function(missingKeys) {
						var missingData = false;
						if (missingKeys.length > 0 && datakeys && datakeys.length > 0) {
							var proceed = true;
							for (var k=0; k<missingKeys.length; k++) {
								if (proceed && me.handlerKeys[handlerTodo].indexOf(missingKeys[k]) > -1) {
									missingData = true;
									logger.debug('MissingKeys: %s; CurrentKey: %s; key: %s', JSON.stringify(missingKeys), missingKeys[k], k);
									datahash = me.response[missingKeys[k]](username, clientHandle, datahash);
									proceed = datahash.proceed;
								}
							}
						}

						if (!missingData) {
							// data is complete and valid
							me.emit('message', Rides.MODULE, username, clientHandle, 'One second, let me see...');
							me.push(username, client.slackHandle, datahash);
						}
						
						logger.debug('Datahash: %s', JSON.stringify(datahash));
						cache.hmset(userkey + ':payload', datahash);

					});
				});
			});
		});	
	});
}

/**
 * Receive a message from back-end handlers for processing
 * @param username - the user this request is associated with
 * @param clientHandle - handle of the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.in = function(msgid, username, clientHandle, body) {
	var me = this;

	// check for message uniqueness
	if (this.msgid !== msgid) {
		//cache.sismember(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', msgid, function(err, check) {
		//	if (!err && check === 0) {
				// not duplicate, process
		//		logger.warn('MESSAGE deets ' + msgid + JSON.stringify(body));
		//		cache.sadd(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', msgid);
				me.emit('message', Rides.MODULE, username, clientHandle, body.text);
		//	}	
		//});
		this.msgid = msgid;
	}
	//cache.expire(CACHE_PREFIX + username + '@' + clientHandle + ':msgid', MSGKEYS_TTL);	
}


/**
 * Push a message to the message exchange for a handler to pick up
 * @param clientHandle - handle of the company that owns this message
 * @param message - JSON object with message to be processed by the handler
 */
Rides.prototype.push = function(username, clientHandle, body) {
	data = {  'id': new Date().getTime(), 'user': username, 'client': clientHandle, 'body': body };
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.out>...', Rides.MODULE);
	var me = this;
	this.pub.connect('piper.events.out', function() {
		logger.info('%s Processor: <piper.events.out> connected', Rides.MODULE);
		me.pub.publish(clientHandle + '.' + Rides.MODULE.toLowerCase(), JSON.stringify(data));
	});
}

function getLocationLink(){
	// provide path to file to utils object and retrieve url
	return utils.getAbsoluteURL("./geo.html", Rides.MODULE);
	// retrieve 
}

module.exports = Rides;



