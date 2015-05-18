var EventEmitter = require('events').EventEmitter;
var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var utils = require('../../../shared/lib/utils');
var scheduler = require('../../../shared/lib/scheduler');
var User = require('../../../shared/models/User');
var responses = require('./dict/responses.json');
var capabilities = require('./dict/capabilities.json');
var geo = require('./lib/geo');
//var chitchat = require('./lib/chitchat');
var when = require('when');
var moment = require('moment');
var momentz = require('moment-timezone');
var request = require('request-promise');

var CACHE_PREFIX = 'home:';
var MSGKEYS_TTL = 300;
var CONTEXT_TTL = 900;
var ONE_DAY_TTL = 86400;


cache.on("error", function (err) {
    logger.error("Redis Error: " + err); 
});

function getUserKey(username, clientHandle) {
	return CACHE_PREFIX + username + '@' + clientHandle;
}

function Home(data) {
	EventEmitter.call(this);
	this.pub = mq.context.socket('PUB', {routing: 'topic'});
	this.sub = mq.context.socket('SUB', {routing: 'topic'});
	this.msgid = new Date().getTime();
	var me = this;

	this.handlerKeys = {
		'home_prompt' : [
						'default'
					],
		'home_get_about' : [
						'default'
					],
		'home_get_capabilities' : [
						'default'
					],
		'home_chitchat' : [
						'textMessage'
					]				
	};

	this.validations = {
		'default' : [
						function(d, b, i) {
							return true;
						}
				],
		'textMessage' : [
						function(d, b, i) {
							d.textMessage = b._text;
							b.touch = true;
							return true;
						}
				]
	};

	this.response = {};
	
	this.failover = {
		'home_prompt' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'yes') {
									var responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Home.MODULE, user.name, clientHandle, responseText);
									return false;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Home.MODULE, user.name, clientHandle, responseText);
									return false;
								}	
							}				
	};

	this.handleRequest = {
		'home_get_capabilities' : function(user, clientHandle, data) {
						var helpMessage = 'Here are some things I can help you with';
						for (var i=0; i<capabilities.length; i++) {
							helpMessage +=  '\n>• ' + capabilities[i].text;
						}
						me.emit('message', Home.MODULE, user.name, clientHandle, helpMessage);			
						return true;
					},
		'home_get_about' : function(user, clientHandle, data) {
						me.emit('message', Home.MODULE, user.name, clientHandle, 'I am Piper, your personal assistant. Now enough about me...how can I help you?');
						return true;
					},
		'home_prompt' : function(user, clientHandle, data) {
						me.emit('message', Home.MODULE, user.name, clientHandle, 'Hi, what can I help you with?');
						return true;
					},
		'home_chitchat' : function(user, clientHandle, data) {
						/* invoke chitchat processor with textMessage
						 * retrieve response and send back to user
						 */
						 
						// return chitchat.processMessage(user.name + '@' + clientHandle, data.textMessage).then(function(responseText)) {
							// me.emit('message', Home.MODULE, user.name, clientHandle, responseText);
							me.emit('message', Home.MODULE, user.name, clientHandle, 'Your message is ' + data.textMessage);
							return true;
						//});
					}			
					
	};

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

function getActiveSession(username, clientHandle) {
	var userkey = getUserKey(username, clientHandle);
	return cache.hgetall(userkey + ':payload');
}

function deleteActiveSession(username, clientHandle) {
	var userkey = getUserKey(username, clientHandle);
	cache.del(userkey + ':payload');
}


Home.prototype = Object.create(EventEmitter.prototype);
Home.prototype.constructor = Home;
Home.MODULE = 'HOME';

Home.prototype.init = function(){
	// subscribe to inbound MQ exchange
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.in>...', Home.MODULE);
	this.sub.connect('piper.events.in', Home.MODULE.toLowerCase(), function() {
		logger.info('%s Processor: <piper.events.in> connected', Home.MODULE);
	});
	var me = this;
	this.sub.on('data', function(data) {
		var jsonData = JSON.parse(data);
		if (data) me.in(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
	});

};

/**
 * Receive a message for processing from the front-end
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Home.prototype.out = function(user, client, body) {
	var me = this;
	
	checkActiveSession(user.name, client.slackHandle).then(function(activeSession) {
		if ((body.outcomes[0].intent === 'default_prompt' || body.outcomes[0].intent === 'confused') && !activeSession) {
			var handlerTodo = 'home_prompt';
			body.touch = true;  // confirms the statement is understood
		} else if (body.outcomes[0].intent === 'confused' && activeSession.handlerTodo) {
			handlerTodo = activeSession.handlerTodo;
			body.touch = true;  // confirms the statement is understood 
		} else if (body.outcomes[0].intent === 'home_info_query' || body.outcomes[0].intent === 'default_info_query' || body.context.state === 'HOME_info_query' ) {
			handlerTodo = 'home_get_info';
		} else {
			handlerTodo = 'home_chitchat';
		} 
		
		logger.debug('Home.HandlerTodo->First Cut: %s', handlerTodo);
		
		if (handlerTodo === 'home_get_info') handlerTodo = getInfoQuery(body);
		
		logger.debug('HandlerTodo->2nd Cut (Home.GetInfoQuery): %s', handlerTodo);
		logger.debug('Body Touched?: %s', body.touch);
		
		me.processData(user, client.slackHandle, body, handlerTodo);  
		
	});	
};


function getInfoQuery(body) {
	if (body.outcomes[0].entities.infotype) {
		var infotype = body.outcomes[0].entities.infotype[0].value;
		logger.debug('Home.GetInfoQuery->Infotype: %s', infotype);
		switch (infotype) {
			case 'about':
				body.touch = true;
				return 'home_get_about';
				break;
			case 'capabilities':
				body.touch = true;
				return 'home_get_capabilities';
				break;
			default:
				return 'home_prompt';
		}		
	} else {
		return 'home_chitchat';
	}
}


/**
 * Validate data sufficiency and trigger request to endpoint
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Home.prototype.processData = function(user, clientHandle, body, handlerTodo) {
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
												me.handleRequest[handlerTodo](user, clientHandle, datahash);
												
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


	
/**
 * Receive a message from back-end handlers for processing
 * @param username - the user this request is associated with
 * @param clientHandle - handle of the company that owns this message
 * @param body - JSON object with request details
 */
Home.prototype.in = function(msgid, username, clientHandle, body) {
	var me = this;
	
	// check for message uniqueness
	if (this.msgid !== msgid) {
		this.msgid = msgid;
	}
		
};


/**
 * Push a message to the message exchange for a handler to pick up
 * @param clientHandle - handle of the company that owns this message
 * @param message - JSON object with message to be processed by the handler
 */
Home.prototype.push = function(user, clientHandle, body) {
	var data = {  'id': new Date().getTime(), 'user': user, 'client': clientHandle, 'body': body };
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.out>...', Home.MODULE);
	var me = this;
	this.pub.connect('piper.events.out', function() {
		logger.info('%s Processor: <piper.events.out> connected', Home.MODULE);
		me.pub.publish(Home.MODULE.toLowerCase() + '.' + clientHandle, JSON.stringify(data));
	});
};


/*
function setProductsData(username, clientHandle, body) {
	var userkey = getUserKey(username, clientHandle);
	cache.hset(userkey + ':payload', 'products', JSON.stringify(body.products));
}*/

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


module.exports = Home;



