var EventEmitter = require('events').EventEmitter

var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var utils = require('../../../shared/lib/utils');
var User = require('../../../shared/models/User');
var responses = require('./dict/responses.json');
var keywords = require('./dict/keywords.json');
var errorContext = require('./dict/error_context.json');
var when = require('when');
var geo = require('./lib/geo');

var CACHE_PREFIX = 'rides:';
var MSGKEYS_TTL = 300;
var CONTEXT_TTL = 1800;
var START_LOC = 11;
var END_LOC = 12;


cache.on("error", function (err) {
    logger.error("Redis Error: " + err);
});

var errKeys = Object.keys(errorContext);

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
						'carrier',
						'endAddress',
						'departureTime',
						'confirmRequest'
					],
		'rides_cancel_trip' : [
						'confirmCancellation'
					],
		'rides_get_info' : [
						'infotype'
					]			
	};

	this.validations = {
		'confirmCancellation' : [
						function(d, b, i) {
							var state = b.context.state;
							if (d.confirmNeed !== true && d.confirmNeed !== 'true') return true; // no need to cancel, no active trip
							if ((state === 'RIDES_confirm_cancellation' && i.yes_no === 'yes') || d.confirmCancellation === true) return d.confirmCancellation = true;
							if (state === 'RIDES_confirm_cancellation' && d.intent === 'rides_cancel_trip') return d.confirmCancellation = true;
							if ((state === 'RIDES_confirm_cancellation' && i.yes_no === 'no') || d.confirmCancellation === false)  {
								d.confirmCancellation = false;
								d.errConfirmCancellation = 'CANCEL_REQUEST_CANCEL';
								return false;
							}
							return false;
						}
					],
		'confirmNeed' : [
						function(d, b, i) {
							if (d.rideRequested === true || d.rideRequested === 'true') return true;
							return false;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (d.intent !== 'rides_go_out' && state !== 'RIDES_confirm_ride_needed') return d.confirmNeed = true;
							if (d.intent === 'rides_request_trip') return d.confirmNeed = true;
							if ((state === 'RIDES_confirm_ride_needed' && i.yes_no === 'yes')  || d.confirmNeed === true || d.confirmNeed === 'true') {
								return d.confirmNeed = true;
							}
							if ((state === 'RIDES_confirm_ride_needed' && i.yes_no === 'no') || d.confirmNeed === false || d.confirmNeed === 'false') {
								d.confirmNeed = false;
								return true;
							}
							return false;
						}
					],
		'startLong' : [
						function(d, b, i) {
							if (d.rideRequested === true || d.rideRequested === 'true') return true;
							return false;
						},
						function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagSL = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagSL) delete d.cancelFlagSL;
								if (d.errStartLocation === 'CONFIRM_REQUEST_CANCEL') delete d.errStartLocation;
							}
							return false;
						},	
						function(d, b, i) {
							var state = b.context.state;
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							if (!d.startLong || d.startLong === 0) return false;
							return true;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (i.location) setTerminal(d, b, i);
							if (i.from) {
								// check for location keyword
								var lockeyword;
								if (lockeyword = getLocationKeyword(i.from)) {
									// if keyword, check if preferences set
									d.fromLocKeyword = lockeyword;
									return User.getUserPreference(b.user.email, lockeyword + '_address').then (function(doc) {
										logger.debug('Got to then of getUserPreference...')
											
										if (doc) {
											i.from = doc.pValue;
											return getLocationByAddress(i.from).then (function (location) {
												if (location) {
													d.startLong = location.longt;
													d.startLat = location.lat;
													delete d.currLocation;
													if (d.errStartLocation === 'BAD_START_ADDRESS') delete data.errStartLocation;
													return true;
												} else {
													d.errStartLocation = 'BAD_START_ADDRESS';
													return false;
												}
											});
										} else {
											// does not exist in preferences
											logger.debug('Got to setting of errLocation...')
											d.errStartLocation = 'NO_PREFERENCE';
											return false;
										}
									});
								} else {
									return getLocationByAddress(i.from)
										.then (function (location) {
											if (location) {
												d.startLong = location.longt;
												d.startLat = location.lat;
												delete d.currLocation;
												if (d.errStartLocation === 'BAD_START_ADDRESS') delete data.errStartLocation;
												return true;
											} else {
												d.errStartLocation = 'BAD_START_ADDRESS';
												return false;
											}
										})
										.then (function(retVal) {
											if (retVal && state === 'RIDES_get_preference') {
												if (d.fromLocKeyword && d.fromLocKeyword != false) {
													// set preference
													User.findOneAndUpdate (
														{ email: b.user.email }, 
														{ preferences   : [{
														      pKey            : d.fromLocKeyword + '_address'
														    , pValue          : i.from
														  }]
														},
														{upsert: true}, function (err) {
														if (err) {
															logger.error('Unable to update user preferences: ' + err);
														} else {
															if (d.errStartLocation === 'NO_PREFERENCE') delete d.errStartLocation;
															delete d.fromLocKeyword;
															logger.info('User Preferences for User %s successfully created', b.user.email);
														}
													});

													
												}
											}
											return retVal;
										});
								}	
							} else {
								return false;
							}
						}
							
					],
		'carrier' 	: [
						function(d, b, i) {
							if (d.rideRequested === true || d.rideRequested === 'true') return true;
							return false;
						},
						function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagCA = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagCA) delete d.cancelFlagCA;
								if (d.errCarrier === 'CONFIRM_REQUEST_CANCEL') delete d.errCarrier;
							}
							return false;
						},
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return true;
						}
					],
		'endAddress': [
						function(d, b, i) {
							if (d.rideRequested === true || d.rideRequested === 'true') return true;
							return false;
						},
						function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagEA = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagEA) delete d.cancelFlagEA;
								if (d.errEndAddress === 'CONFIRM_REQUEST_CANCEL') delete d.errEndAddress;
							}
							return false;
						},
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return true;
						}
					],
		'departureTime': [
						function(d, b, i) {
							if (d.rideRequested === true || d.rideRequested === 'true') return true;
							return false;
						},
						function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagDT = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagDT) delete d.cancelFlagDT;
								if (d.errDepartureTime === 'CONFIRM_REQUEST_CANCEL') delete d.errDepartureTime;
							}
							return false;
						},
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return true;
						}
					],
		'confirmRequest' : [
						function(d, b, i) {
							if (d.rideRequested === true || d.rideRequested === 'true') return true;
							return false;
						},
						function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagCR = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagCR) delete d.cancelFlagCR;
								if (d.errConfirmRequest === 'CONFIRM_REQUEST_CANCEL') delete d.errConfirmRequest;
							}
							return false;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (d.confirmNeed === false) return true; // exit validations if trip cancelled
							if ((state === 'RIDES_confirm_request' && i.yes_no === 'yes') || d.confirmRequest === true || d.confirmRequest === 'true') {
								d.rideRequested = true;
								return d.confirmRequest = true;
							}
							if ((state === 'RIDES_confirm_request' && i.yes_no === 'no') || d.confirmRequest === false || d.confirmRequest === 'false')  {
								d.confirmRequest = false;
								return false;
							}
							return false;
						}
					],
		'infotype': [
						function(d, b, i) {
							if(i.infotype) {
								d.infotype = i.infotype;
								return true;
							}  // exit validations if trip cancelled
							return false;
						}
					]

	};

	this.response = {
		'confirmCancellation' : function(user, clientHandle, data) {
						if (!data.errConfirmCancellation || errKeys.indexOf(data.errConfirmCancellation) < 0) data.errConfirmCancellation = 'NO_CONFIRM_CANCEL'; 
						var responseText = getResponse(data, data.errConfirmCancellation);
						
						responseText = responseText.replace("@username", user.name);
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errConfirmCancellation]);
						delete data.errConfirmCancellation;
						return false;
					},	
		'confirmNeed' : function(user, clientHandle, data) {
						logger.debug('data.confirmNeed1: %s', data.errConfirmNeed);
						if (!data.errConfirmNeed || errKeys.indexOf(data.errConfirmNeed) < 0) data.errConfirmNeed = 'NO_CONFIRM_NEED'; 
						logger.debug('data.confirmNeed2: %s', data.errConfirmNeed);
						var responseText = getResponse(data, data.errConfirmNeed);
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errConfirmNeed]);
						delete data.errConfirmNeed;
						return false;
					},	
		'startLong' : function(user, clientHandle, data) {
						if (data.cancelFlagSL === true) {
							data.errStartLocation = "CONFIRM_REQUEST_CANCEL";
							delete d.cancelFlagSL;
						} else if (!data.errStartLocation || errKeys.indexOf(data.errStartLocation) < 0) {
							data.errStartLocation = 'NO_START_LOCATION'; 
						}

						var responseText = getResponse(data, data.errStartLocation);

						responseText = responseText.replace("@locationlink", getLocationLink(user.name, clientHandle));
						responseText = responseText.replace("@lockeyword", data.fromLocKeyword);
						responseText = responseText.replace("@username", user.name);
						responseText = responseText.replace("@address", data.tempLocation);
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errStartLocation]);
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
						if (data.cancelFlagCR === true) {
							data.errConfirmRequest = "CONFIRM_REQUEST_CANCEL";
							delete d.cancelFlagCR;
						} else if (!data.errConfirmRequest || errKeys.indexOf(data.errConfirmRequest) < 0) {
							data.errConfirmRequest = 'NO_CONFIRM_REQUEST'; 
						}
						var responseText = getResponse(data, data.errConfirmRequest).replace("@username", user.name);
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errConfirmRequest]);
						delete data.errConfirmRequest;
						return false;
					},
		'infotype' : function(user, clientHandle, data) {
						me.emit('message', Rides.MODULE, user.name, clientHandle, 'What do you want to know?', Rides.MODULE + "_info_query");
						return false;
					},			
					
	};

	this.handleRequest = {
		'rides_cancel_trip' : function(user, clientHandle, data) {
						if (data.confirmCancellation === true) {
							me.cancelRequest(user.name, clientHandle, data);
							me.emit('message', Rides.MODULE, user.name, clientHandle, 'Fine, your trip request has been cancelled');
						} else {
							me.emit('message', Rides.MODULE, user.name, clientHandle, "You have no active ride requests to cancel");
						}
					},
		'rides_request_price_estimate' : function(user, clientHandle, data) {

					},
		'rides_request_eta' : function(user, clientHandle, data) {

					},
		'rides_book_trip' : function(user, clientHandle, data) {
						logger.debug('HandleRequest: handling for rides_book_trip... %s', JSON.stringify(data));
						if (data.confirmNeed === false) {
							if (data.rideRequested !== true && data.rideRequested !== 'true') {
								logger.debug('HandleRequest: handling for rides_book_trip...calling cancelrequest');
								me.cancelRequest(user.name, clientHandle, data);
							}
						} else {
							if (data.rideRequested === true || data.rideRequested === 'true') {
								// trip already active
							} else {
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'One second, let me see...');
								me.push(user, clientHandle, data);
							}	
						}
					},
		'rides_get_info' : function(user, clientHandle, data) {
						me.emit('message', Rides.MODULE, user.name, clientHandle, 'You want to know ' + data.infotype);
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
	
	if (body.outcomes[0].intent === 'rides_cancel_trip' || body.outcomes[0].intent === 'default_cancel_request' || body.context.state === 'RIDES_confirm_cancellation') {
		handlerTodo = 'rides_cancel_trip';
	} else if (body.outcomes[0].intent === 'rides_request_price_estimate' || body.context.state === 'RIDES_request_price_estimate') {
		handlerTodo = 'rides_request_price_estimate';
	} else if (body.outcomes[0].intent === 'rides_request_eta' || body.context.state === 'RIDES_request_eta') {
		handlerTodo = 'rides_request_eta';
	} else if (body.outcomes[0].intent === 'rides_info_query' || body.context.state === 'RIDES_info_query' ) {
		handlerTodo = 'rides_get_info';
	} else {
		handlerTodo = 'rides_book_trip';
	}  
            
    this.processData(user, client.slackHandle, body, handlerTodo);

}


/**
 * Validate data sufficiency and trigger request to endpoint
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.processData = function(user, clientHandle, body, handlerTodo) {
    var me = this;
    var username = user.name;
	var userkey = CACHE_PREFIX + username + '@' + clientHandle;
	
	var indata = extractEntities(body);

	if (body.outcomes) {
		if (body.outcomes[0].intent === 'default_accept') indata.yes_no = 'yes';
		if (body.outcomes[0].intent === 'default_reject') indata.yes_no = 'no';
	}

	body.user = user;

	// check if this is a new request from the user
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
				validationPromises = [],
				fvPromises = [];
			for (var i=0; i<datakeys.length; i++) {
				validationPromises[i] = [];
				for (var f=0; f<me.validations[datakeys[i]].length; f++) {
					validationPromises[i][f] = when.lift(me.validations[datakeys[i]][f])(datahash, body, indata);
				}

				fvPromises[i] = when.reduce(validationPromises[i], function (validAgg, value, index) {
				    //logger.debug('ROOT CALLER %s -> %s', index, value);
				    return validAgg || value;
				}, false);
			}

			for (var i=0; i<validationPromises.length; i++) {
				for (var f=0; f<validationPromises[i].length; f++) {
					(function(_i, _f) {
						validationPromises[_i][_f].then(function (ret) {
							logger.debug('%s: %s -> %s', datakeys[_i], _f, ret);
						});	
					} (i, f));
					
				}
			}
		

			when.all(fvPromises).then(function(validityChecks) {
				for (var i=0; i<validityChecks.length; i++) {
					logger.debug('Datakey: %s, Validity Check: %s', datakeys[i], validityChecks[i]);

					if (validityChecks[i]) {
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
						logger.debug('Body: %s', JSON.stringify(body));
						logger.debug('Indata: %s', JSON.stringify(indata));

						logger.debug(userkey);
						if (datahash.lvlQueries) logger.debug('Datahash.lvlQueries: %s', JSON.stringify(datahash.lvlQueries));
						datahash.lvlQueries = JSON.stringify(datahash.lvlQueries);
						cache.hmset(userkey + ':payload', datahash);

						if (!missingData) {
							// data is complete and valid
							logger.debug('No more missing data: calling handleRequest for %s', handlerTodo);
							me.handleRequest[handlerTodo](user, clientHandle, datahash);
						}

						

						
					});
				});
			});
		});
		cache.expire(userkey + ':payload', CONTEXT_TTL);
		cache.expire(userkey + ':datacheck', CONTEXT_TTL);
			
	
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
		switch (body.header) {
			case 'GEO_DATA':
				setUserGeoData(username, clientHandle, body);
				logger.debug('Done setting user geodata...');
				this.emit('message', Rides.MODULE, username, clientHandle, 'Thanks, I have your location \n' + geo.getGeoStaticMapLink(body.lat, body.longt));

				//refresh dialog
				cache.hgetall(username + '@' + clientHandle).then(function(user){
					var handlerTodo = 'rides_book_trip';
					var body = { context: { state : Rides.MODULE }};
					if (user) me.processData(user, clientHandle, body, handlerTodo);
				});

				break;
		}
		
		this.msgid = msgid;
	}
		
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

function setUserGeoData(username, clientHandle, body) {
	var userkey = CACHE_PREFIX + username + '@' + clientHandle;
	var geodata = { startLat : body.lat, startLong : body.longt };
	cache.hmset(userkey + ':payload', geodata);
}


function extractEntities(body) {
	var indata = {};
	var entitites = {};
	if (body.outcomes) entities = body.outcomes[0].entities;
	var eKeys = Object.keys(entities);

	logger.debug('Entities: %s', JSON.stringify(entities));

	if (eKeys) {
		for (var e=0; e<eKeys.length; e++) {
			indata[eKeys[e]] = entities[eKeys[e]][0].value;
		}
	}
	return indata;
}

function getLocationByAddress(address) {
	return when({longt : 1, lat: 1});
}

function getResponse(data, errorMsg) {
	if (!data.lvlQueries) data.lvlQueries = {};
	logger.debug('1. getResponse(): data.lvlQueries[%s] -> %s', errorMsg, data.lvlQueries[errorMsg]);
	if (!data.lvlQueries[errorMsg] || isNaN(data.lvlQueries[errorMsg])) data.lvlQueries[errorMsg] = 0;
	logger.debug('2. getResponse(): data.lvlQueries[%s] -> %s', errorMsg, data.lvlQueries[errorMsg]);
	while (!responses[errorMsg][data.lvlQueries[errorMsg]] && data.lvlQueries[errorMsg] > 0) data.lvlQueries[errorMsg]--;
	logger.debug('3. getResponse(): data.lvlQueries[%s] -> %s', errorMsg, data.lvlQueries[errorMsg]);
	
	var responseText = responses[errorMsg][data.lvlQueries[errorMsg]] ? responses[errorMsg][data.lvlQueries[errorMsg]] : "I'm a bit confused..."; 
	data.lvlQueries[errorMsg]++; 
	return responseText;
}

function getLocationKeyword(location) {
	if ((location.match(/\d+/g) != null)) return false; // reject if location contains a number
	
	var reqkey = false;

	var lkKeys = Object.keys(keywords.locations);
	logger.debug('lkKeys: %s', lkKeys);		
	lkKeys.forEach(function(lkKey) {
		var keywordList = keywords.locations[lkKey];
		logger.debug('keywordList: %s', keywordList);
		keywordList.forEach(function(keyword) {
			logger.debug('location.search(%s): %s', keyword, location.search(keyword));
			if (location.search(keyword) > -1) {
				reqkey = lkKey;
			}
		});
	})
	return reqkey;
}

function setTerminal(d, b, i) {
	var terminalSet = false;

	// state selection...
	var state = b.context.state;
	switch (state) {
		case 'RIDES_get_start_location':
			i.from = i.location;
			d.currLocation = START_LOC; 
			terminalSet = true;
			break;
		case 'RIDES_get_end_location':
			i.to = i.location;
			d.currLocation = END_LOC; 
			terminalSet = true;
			break;
		case 'RIDES_confirm_start_location':
			if (i.yes_no === 'yes') {
				i.from = d.tempLocation;
				d.currLocation = END_LOC;
				delete d.tempLocation;
				terminalSet = true;
			}
			if (i.yes_no === 'no') {
				i.to = d.tempLocation;
				d.currLocation = END_LOC;
				delete d.tempLocation;
				terminalSet = true;
			}
			break;
	}


	// fromTo memory selection
	if (!terminalSet) {
		switch (d.currLocation) {
			case START_LOC:
				i.from = i.location;
				terminalSet = true;
				break;
			case END_LOC:
				i.to = i.location;
				terminalSet = true;
				break;
		}
	}

	// Preferences set selection
	if (!terminalSet) {
		if (d.fromLocKeyword && d.fromLocKeyword != false) {
			i.from = i.location;
			terminalSet = true;
		} else if (d.toLocKeyword && d.toLocKeyword != false) {
			i.to = i.location;
			terminalSet = true;
		}
	}


	if (!terminalSet) {
		d.errStartLocation = 'UNKNOWN_TERMINAL';
		d.tempLocation = i.location;
	}

}




function getLocationLink(username, clientHandle){
	var ret = utils.getUserLocationLink(username, clientHandle, Rides.MODULE);
	if (ret) return ret;
	return '[Oops, missing link :thumbsdown:]';
}

module.exports = Rides;



