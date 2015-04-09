var EventEmitter = require('events').EventEmitter

var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var utils = require('../../../shared/lib/utils');
var responses = require('./responses.json');
var when = require('when');

var CACHE_PREFIX = 'rides:';
var MSGKEYS_TTL = 300;
var CONTEXT_TTL = 1800;
	
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
					],
		'rides_cancel_trip' : [
						'confirmCancellation'
					]			
	};

	this.validations = {
		'confirmCancellation' : [
						function(d, b) {
							logger.debug('Got here in confirmNeed... d.confirmNeed is %s', d.confirmNeed)
							if (d.confirmCancellation === 'true' || d.confirmCancellation === true) return d.confirmCancellation = true;
							if (d.confirmCancellation === 'false' || d.confirmCancellation === false) {
								d.confirmCancellation = false;
								return true;
							}
							return false;
						}
					],
		'confirmNeed' : [
						function(d, b) {
							if (d.intent !== 'rides_go_out' && b.context.state !== 'RIDES_confirm_ride_needed') return true;
							logger.debug('Got here in confirmNeed... d.confirmNeed is %s', d.confirmNeed)
							if (d.confirmNeed === 'true' || d.confirmNeed === true) return d.confirmNeed = true;
							if (d.confirmNeed === 'false' || d.confirmNeed === false) {
								d.confirmNeed = false;
								return true;
							}
							return false;
						}
					],
		'startLong' : [
						function(d, b) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							if (!d.startLong || d.startLong === 0) return false;
							return true;
						}
					],
		'startLat' 	: [
						function(d, b) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							if (!d.startLat || d.startLat === 0) return false;
							return true;
						},
						function(d, b) {
							return true;
						}
					],
		'carrier' 	: [
						function(d, b) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return true;
						}
					],
		'endAddress': [
						function(d, b) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return true;
						}
					],
		'departureTime': [
						function(d, b) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return true;
						}
					],
		'confirmRequest' : [
						function(d, b) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							if (d.confirmRequest === false || d.confirmRequest === 'off') {
								d.confirmRequest = false;
								return true;
							}
							if (d.confirmRequest === 'on' || d.confirmRequest === true) return d.confirmRequest = true;
							return false;
						}
					]

	};

	this.response = {
		'confirmCancellation' : function(user, clientHandle, data) {
						if (!data.lvlConfirmCancellationQueries || isNaN(data.lvlConfirmCancellationQueries)) data.lvlConfirmCancellationQueries = 0;
						while (!responses.confirmCancellation[data.lvlConfirmCancellationQueries] && data.lvlConfirmCancellationQueries > 0) data.lvlConfirmCancellationQueries--;
						var responseText = responses.confirmCancellation[data.lvlConfirmCancellationQueries] ? responses.confirmCancellation[data.lvlConfirmCancellationQueries] : "I'm a bit confused..."; 
						data.lvlConfirmCancellationQueries++; 
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, Rides.MODULE + "_confirm_cancellation");
						return false;
					},	
		'confirmNeed' : function(user, clientHandle, data) {
						if (!data.lvlConfirmNeedQueries || isNaN(data.lvlConfirmNeedQueries)) data.lvlConfirmNeedQueries = 0;
						//logger.debug('lvlConfirmNeedQueries2: %s', data.lvlConfirmNeedQueries);
						while (!responses.confirmNeed[data.lvlConfirmNeedQueries] && data.lvlConfirmNeedQueries > 0) data.lvlConfirmNeedQueries--;
						var responseText = responses.confirmNeed[data.lvlConfirmNeedQueries] ? responses.confirmNeed[data.lvlConfirmNeedQueries] : "I'm a bit confused..."; 
						data.lvlConfirmNeedQueries++; // data.lvlConfirmNeedQueries ? data.lvlConfirmNeedQueries + 1 : 0;
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, Rides.MODULE + "_confirm_ride_needed");
						return false;
					},	
		'startLong' : function(user, clientHandle, data) {
						if (!data.lvlLocationQueries || isNaN(data.lvlLocationQueries)) data.lvlLocationQueries = 0;
						while (!responses.location[data.lvlLocationQueries] && data.lvlLocationQueries > 0) data.lvlLocationQueries--;
						var responseText = responses.location[data.lvlLocationQueries] ? responses.location[data.lvlLocationQueries].replace("@locationlink", getLocationLink()) : "I'm a bit confused..."; 
						data.lvlLocationQueries++;

						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, Rides.MODULE + "_get_location");
						return false;
					},
		'startLat' 	: function(user, clientHandle, data) {
						if (!data.lvlLocationQueries || isNaN(data.lvlLocationQueries)) data.lvlLocationQueries = 0;
						while (!responses.location[data.lvlLocationQueries] && data.lvlLocationQueries > 0) data.lvlLocationQueries--;
						var responseText = responses.location[data.lvlLocationQueries] ? responses.location[data.lvlLocationQueries].replace("@locationlink", getLocationLink()) : "I'm a bit confused..."; 
						data.lvlLocationQueries++;
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, Rides.MODULE + "_get_location");
						return false;
					},
		'carrier' 	: function(user, clientHandle, data) {
						if (data.preferredCarrier) {
							if (!data.lvlCarrierQueries || isNaN(data.lvlCarrierQueries)) data.lvlCarrierQueries = 0;
							while (!responses.carrier[data.lvlCarrierQueries] && data.lvlCarrierQueries > 0) data.lvlCarrierQueries--;
							var responseText = responses.carrier[data.lvlCarrierQueries] ? responses.carrier[data.lvlCarrierQueries].replace("@preferredCarrier", data.preferredCarrier) : "I'm a bit confused..."; 
							data.lvlCarrierQueries++;
						
							me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, Rides.MODULE + "_confirm_carrier");
						} 
						return false;
					},
		'endAddress': function(user, clientHandle, data) {
						return true;
					},
		'departureTime' : function(user, clientHandle, data) {
						return true;
					},
		'confirmRequest' : function(user, clientHandle, data) {
						if (!data.lvlConfirmRequestQueries || isNaN(data.lvlConfirmRequestQueries)) data.lvlConfirmRequestQueries = 0;
						while (!responses.confirmRequest[data.lvlConfirmRequestQueries] && data.lvlConfirmRequestQueries > 0) data.lvlConfirmRequestQueries--;
						var responseText = responses.confirmRequest[data.lvlConfirmRequestQueries] ? responses.confirmRequest[data.lvlConfirmRequestQueries].replace("@username", username) : "I'm a bit confused..."; 
						data.lvlConfirmRequestQueries++;

						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, Rides.MODULE + "_confirm_request");
						return false;
					}			
					
	};

	this.handleRequest = {
		'rides_cancel_trip' : function(user, clientHandle, data) {
						me.cancelRequest(user.name, clientHandle, data);
						me.emit('message', Rides.MODULE, user.name, clientHandle, 'Fine, your trip request has been cancelled');
					},
		'rides_request_price_estimate' : function(user, clientHandle, data) {

					},
		'rides_request_eta' : function(user, clientHandle, data) {

					},
		'rides_book_trip' : function(user, clientHandle, data) {
						logger.debug('HandleRequest: handling for rides_book_trip... %s', JSON.stringify(data));
						if (data.confirmNeed === false) {
							logger.debug('HandleRequest: handling for rides_book_trip...calling cancelrequest');
							me.cancelRequest(user.name, clientHandle, data);
						} else {
							me.emit('message', Rides.MODULE, user.name, clientHandle, 'One second, let me see...');
							me.push(user, clientHandle, data);
						}
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
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.out = function(user, client, body) {
	var handlerTodo = '';
	
	if (body.outcomes[0].intent === 'rides_cancel_trip' || body.context.state === 'RIDES_confirm_cancellation') {
		handlerTodo = 'rides_cancel_trip';
	} else if (body.outcomes[0].intent === 'rides_request_price_estimate' || body.context.state === 'RIDES_request_price_estimate') {
		handlerTodo = 'rides_request_price_estimate';
	} else if (body.outcomes[0].intent === 'rides_request_eta' || body.context.state === 'RIDES_request_eta') {
		handlerTodo = 'rides_request_eta';
	} else {
		handlerTodo = 'rides_book_trip';
	}  
            
    this.processData(user, client, body, handlerTodo);

}


/**
 * Validate data sufficiency and trigger request to endpoint
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.processData = function(user, client, body, handlerTodo) {
    var me = this;
    var clientHandle = client.slackHandle;
    var username = user.name;
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
						fieldValid = fieldValid && me.validations[datakeys[i]][f](datahash, body);
					}
					logger.debug('fieldValid: %s, datakeys[i]: %s', fieldValid, datakeys[i] );
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
									proceed = me.response[missingKeys[k]](user, clientHandle, datahash);
								}
							}
						}

						logger.debug('Datahash: %s', JSON.stringify(datahash));
						cache.hmset(userkey + ':payload', datahash);

						if (!missingData) {
							// data is complete and valid
							logger.debug('No more missing data: calling handleRequest for %s', handlerTodo);
							me.handleRequest[handlerTodo](user, client.slackHandle, datahash);
						}

						
					});
				});
			});
			cache.expire(userkey + ':payload', CONTEXT_TTL);
		});
	});
}

/**
 * Cancel request and delete all cache records
 * @param username - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.cancelRequest = function(username, clientHandle, data) {
	logger.debug('CancelRequest: cancelling for ... %s', JSON.stringify(data));
						
	var userkey = CACHE_PREFIX + username + '@' + clientHandle;

    cache.del(userkey + ':payload');
    cache.del(userkey + ':datacheck');
    data = {};
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
Rides.prototype.push = function(user, clientHandle, body) {
	data = {  'id': new Date().getTime(), 'user': user, 'client': clientHandle, 'body': body };
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



