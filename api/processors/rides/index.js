var EventEmitter = require('events').EventEmitter;
var cache = require('../../../shared/lib/cache').getRedisClient();
var logger = require('../../../shared/lib/log');
var mq = require('../../../shared/lib/mq');
var utils = require('../../../shared/lib/utils');
var User = require('../../../shared/models/User');
var responses = require('./dict/responses.json');
var keywords = require('./dict/keywords.json');
var errorContext = require('./dict/error_context.json');
var when = require('when');
var moment = require('moment');
var request = require('request-promise');
var geo = require('./lib/geo');

var CACHE_PREFIX = 'rides:';
var MSGKEYS_TTL = 300;
var CONTEXT_TTL = 1800;
var ONE_DAY_TTL = 86400;
var START_LOC = 11;
var END_LOC = 12;
var CUTOFF_TIME = 60;


cache.on("error", function (err) {
    logger.error("Redis Error: " + err); 
});

var errKeys = Object.keys(errorContext);

function getUserKey(username, clientHandle) {
	return CACHE_PREFIX + username + '@' + clientHandle;
}

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
						'productId',
						'endLong',
						'confirmRequest'
					],
		'rides_schedule_trip' : [
						'endLong',
						'departureTime',
						'confirmSchedule'
					],
		'rides_cancel_trip' : [
						'confirmCancellation'
					],
		'rides_get_driver_location' : [
						'startLong',
						'productId'
					],
		'rides_get_cost' : [
						'startLong',
						'productId',
						'endLong'
					],
		'rides_get_request_status' : [
						'activeRequest'
					],
		'rides_get_driver_info' : [
						'activeRequest'
					],
		'rides_get_vehicle_info' : [
						'activeRequest'
					],
		'rides_get_eta' : [
						'startLong',
						'productId'
					],
		'rides_get_info' : [
						'infotype'
					]				
	};

	this.validations = {
		'confirmCancellation' : [
						function(d, b, i) {
							var state = b.context.state;
							return i.hasActiveRequest.then(function (requestActive) {
								if (state === 'RIDES_confirm_cancellation' && i.yes_no) b.touch = true;
								if ((state === 'RIDES_confirm_cancellation' && i.yes_no === 'no') || d.confirmCancellation === false)  {
									d.confirmCancellation = false;
									d.errConfirmCancellation = 'CANCEL_REQUEST_CANCEL';
									return false;
								}
								if (d.confirmNeed !== true && d.confirmNeed !== 'true' && !requestActive && !d.departureTime) return true; // no need to cancel, no active trip
								if ((state === 'RIDES_confirm_cancellation' && i.yes_no === 'yes') || d.confirmCancellation === true) return d.confirmCancellation = true;
								if (state === 'RIDES_confirm_cancellation' && d.intent === 'rides_cancel_trip') return d.confirmCancellation = true;
								
								return false;
							});
						}
					],
		'activeRequest' : [
						function(d, b, i) {
							return i.hasActiveRequest;
						}
					],
		'confirmNeed' : [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (state === 'RIDES_confirm_ride_needed' && i.yes_no) b.touch = true;
							if (d.intent !== 'rides_go_out' && state !== 'RIDES_confirm_ride_needed' && !b.restart) return d.confirmNeed = true;
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
							return i.hasActiveRequest;
						},
						function(d, b, i) {
							if (d.startLong && d.startLong !== 0) {
								if (i.yes_no === 'no' && i.infotype === 'location') {  // user rejects captured location, can only be 'from'
									delete d.startLong;
									delete d.startLat;
									if (data.lvlQueries && data.lvlQueries[d.errStartLocation] && !isNaN(data.lvlQueries[d.errStartLocation])) data.lvlQueries[d.errStartLocation] = 0; // reset if reset
									b.touch = true;
								}
							}
							return false;
						},
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							if (!d.startLong || d.startLong === 0) return false;
							if (d.errStartLocation === 'NO_START_LOCATION') delete d.errStartLocation;
							return true;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (i.location || d.errStartLocation === 'SUSPECT_START_LOCATION') setTerminal(d, b, i);
							if (i.from) {
								// check for location keyword
								b.touch = true;
								// strip of prefix if
								if (i.from.lastIndexOf('from ', 0) === 0) i.from = i.from.substr(5, i.from.length);
								var lockeyword;
								if (lockeyword = getLocationKeyword(i.from)) {
									// if keyword, check if preferences set
									d.fromLocKeyword = lockeyword;
									return User.getUserPreference(b.user.email, lockeyword + '_address').then (function(doc) {
										logger.debug('Got to then of getUserPreference...');
											
										if (doc) {
											i.from = doc.pValue;
											return getLocationByAddress(i.from).then (function (location) {
												if (location) {
													d.startLong = location.longt;
													d.startLat = location.lat;
													delete d.currLocation;
													if (d.errStartLocation === 'BAD_START_ADDRESS') delete d.errStartLocation;
													return true;
												} else {
													d.errStartLocation = 'BAD_START_ADDRESS';
													return false;
												}
											});
										} else {
											// does not exist in preferences
											logger.debug('Got to setting of errLocation...');
											d.errStartLocation = 'NO_STARTLOC_PREFERENCE';
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
												if (d.errStartLocation === 'BAD_START_ADDRESS') delete d.errStartLocation;
												return true;
											} else {
												d.errStartLocation = 'BAD_START_ADDRESS';
												return false;
											}
										})
										.then (function(retVal) {
											if (retVal && state === 'RIDES_get_startloc_preference') {
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
															if (d.errStartLocation === 'NO_STARTLOC_PREFERENCE') delete d.errStartLocation;
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
						},
						function(d, b, i) {
							if (i.geoFrom) {
								if (d.fromLocKeyword && d.fromLocKeyword != false) {
									// set preference
									User.findOneAndUpdate (
										{ email: b.user.email }, 
										{ preferences   : [{
										      pKey            : d.fromLocKeyword + '_address'
										    , pValue          : i.geoFrom
										  }]
										},
										{upsert: true}, function (err) {
										if (err) {
											logger.error('Unable to update user preferences: ' + err);
										} else {
											if (d.errStartLocation === 'NO_STARTLOC_PREFERENCE') delete d.errStartLocation;
											delete d.fromLocKeyword;
											logger.info('User Preferences for User %s successfully created', b.user.email);
										}
									});
								}
							}
							return false;
						}
							
					],
		'productId' 	: [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return false;
						},
						function(d, b, i) {
							if(d.products && (!d.startLong || d.startLong == 0)) delete d.products; // cancel products if location not set
							return false;
						},
						function(d, b, i) {
							if(!d.products && d.startLong && d.startLong != 0) {
								logger.debug('Going for products...');
								return getProducts(b.user.name, b.clientHandle, d).then(function(prod) {
									if (prod) {
										var jProducts = JSON.parse(prod);
										if (jProducts.products && jProducts.products.length > 0) {
											d.products = true;
											d.productId = jProducts.products[0].product_id;
											d.productName = jProducts.products[0].display_name;
											if (d.carrier) {
												jProducts.products.every(function(product) {
													if (product.display_name.toLowerCase() === d.carrier.toLowerCase()) {
														d.productId = product.product_id;
														d.productName = product.display_name;
														return false;
													}
													return true;
												});
												if (d.productName.toLowerCase() !== d.carrier.toLowerCase()) {
													d.noPreferred = true;
												} else {
													delete d.noPreferred;
												}
											} 
											if (d.unCarrier && d.noPreferred) {
												jProducts.products.every(function(product) {
													if (product.display_name.toLowerCase() !== d.unCarrier.toLowerCase()) {
														d.productId = product.product_id;
														d.productName = product.display_name;
														return false;
													}
													return true;
												});
												if (d.productName.toLowerCase() === d.unCarrier.toLowerCase()) {
													d.onlyUnPreferred = true;
												} else {
													delete d.onlyUnPreferred;
												}
											}
											return true;
										} else {
											d.errProductId = 'NO_PRODUCTS_AVAILABLE';
											return false;
										}
									} else {
										return false;
									}
								});
							} else {
								return false;
							}
						},
						function(d, b, i) {
							var retVal = false;
							if(i.carrier && i.yes_no !== 'no') {
								d.carrier = i.carrier;
								if (d.unCarrier && (d.unCarrier.toLowerCase() === d.carrier.toLowerCase())) delete d.unCarrier;
								b.touch = true;
							}
							return retVal;
						},
						function(d, b, i) {
							var retVal = false;
							if(i.carrier && i.yes_no === 'no') {
								d.unCarrier = i.carrier;
								if (d.carrier && (d.unCarrier.toLowerCase() === d.carrier.toLowerCase())) delete d.carrier;
								b.touch = true;
							}
							return retVal;
						},
						function(d, b, i) {
							if(d.products) {
								logger.debug('Going for time...');
								return getTimeEstimateAll(b.user.name, b.clientHandle, d).then(function(etas) {
									if (etas) {
										var jEtas = JSON.parse(etas);
										var oldProductId = d.productId;
										var oldProductName = d.productName;
										logger.debug('OldProductId: %s', oldProductId);
										logger.debug('NewProductId: %s', d.productId);
										logger.debug('Datahash Val: %s', JSON.stringify(d));
										if (jEtas.times && jEtas.times.length > 0) {
											d.productId = jEtas.times[0].product_id;
											d.productName = jEtas.times[0].display_name;
											if (oldProductId !== d.productId) {
												if (d.carrier) {
													jEtas.times.every(function(product) {
														if (product.display_name.toLowerCase() === d.carrier.toLowerCase()) {
															d.productId = product.product_id;
															d.productName = product.display_name;
															return false;
														}
														return true;
													});
													if (d.carrier.toLowerCase() === oldProductName.toLowerCase() || i.carrier.toLowerCase() === d.carrier.toLowerCase()) {
														if (d.productName.toLowerCase() !== d.carrier.toLowerCase()) {
															logger.debug('***************************************** prefVal: GOT HERE 1');
															logger.debug('OldProductId: %s', oldProductId);
															logger.debug('NewProductId: %s', d.productId);
															d.noPreferred = true;
														} else {
															delete d.noPreferred;
														}
													}
												} 
												if (d.unCarrier && d.noPreferred) {
													jEtas.times.every(function(product) {
														if (product.display_name.toLowerCase() !== d.unCarrier.toLowerCase()) {
															d.productId = product.product_id;
															d.productName = product.display_name;
															return false;
														}
														return true;
													});
													if (d.unCarrier.toLowerCase() !== oldProductName.toLowerCase() || i.carrier.toLowerCase() === d.unCarrier.toLowerCase()) {
														if (d.productName.toLowerCase() === d.unCarrier.toLowerCase()) {
															logger.debug('***************************************** prefVal: GOT HERE 2');
															d.onlyUnPreferred = true;
														} else {
															delete d.onlyUnPreferred;
														}
													}
												}
											} else {
												if (i.carrier && i.yes_no !== 'no') {
													b.touch = true;
													jEtas.times.every(function(product) {
														if (product.display_name.toLowerCase() === i.carrier.toLowerCase()) {
															d.productId = product.product_id;
															d.productName = product.display_name;
															return false;
														}
														return true;
													});
													if (d.productName.toLowerCase() !== i.carrier.toLowerCase()) {
														logger.debug('****************Strange, got here');
														d.noPreferred = true;
													} else {
														delete d.noPreferred;
													}
												} else if (i.carrier && i.yes_no === 'no') {
													b.touch = true;
													jEtas.times.every(function(product) {
														if (product.display_name.toLowerCase() !== i.carrier.toLowerCase()) {
															d.productId = product.product_id;
															d.productName = product.display_name;
															return false;
														}
														return true;
													});
													if (d.productName.toLowerCase() === i.carrier.toLowerCase()) {
														d.onlyUnPreferred = true;
													} else {
														delete d.onlyUnPreferred;
													}
												}
											}
										}
										return true;
									} else {
										return false;
									}
								});
							} else {
								return false;
							}
						},
						function(d, b, i) {
							if (d.productId) return true;
							return false;
						}
					],
		'endLong': [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							if (!d.endLong || d.endLong === 0) return false;
							if (d.errEndLocation === 'NO_END_LOCATION') delete d.errEndLocation;
							return true;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (i.location || d.errEndLocation === 'SUSPECT_END_LOCATION') setTerminal(d, b, i);
							if (i.to) {
								// check for location keyword
								b.touch = true;
								if (i.to.lastIndexOf('to ', 0) === 0) i.to = i.to.substr(3, i.to.length);
								
								var lockeyword;
								if (lockeyword = getLocationKeyword(i.to)) {
									// if keyword, check if preferences set
									d.toLocKeyword = lockeyword;
									return User.getUserPreference(b.user.email, lockeyword + '_address').then (function(doc) {
										logger.debug('Got to then of getUserPreference...');
											
										if (doc) {
											i.to = doc.pValue;
											return getLocationByAddress(i.to).then (function (location) {
												if (location) {
													d.endLong = location.longt;
													d.endLat = location.lat;
													delete d.currLocation;
													if (d.errEndLocation === 'BAD_END_ADDRESS') delete d.errEndLocation;
													return true;
												} else {
													d.errEndLocation = 'BAD_END_ADDRESS';
													return false;
												}
											});
										} else {
											// does not exist in preferences
											logger.debug('Got to setting of errEndLocation...');
											d.errEndLocation = 'NO_ENDLOC_PREFERENCE';
											return false;
										}
									});
								} else {
									return getLocationByAddress(i.to)
										.then (function (location) {
											if (location) {
												d.endLong = location.longt;
												d.endLat = location.lat;
												delete d.currLocation;
												if (d.errEndLocation === 'BAD_END_ADDRESS') delete d.errEndLocation;
												return true;
											} else {
												d.errEndLocation = 'BAD_END_ADDRESS';
												return false;
											}
										})
										.then (function(retVal) {
											if (retVal && state === 'RIDES_get_endloc_preference') {
												if (d.toLocKeyword && d.toLocKeyword != false) {
													// set preference
													User.findOneAndUpdate (
														{ email: b.user.email }, 
														{ preferences   : [{
														      pKey            : d.toLocKeyword + '_address'
														    , pValue          : i.to
														  }]
														},
														{upsert: true}, function (err) {
														if (err) {
															logger.error('Unable to update user preferences: ' + err);
														} else {
															if (d.errEndLocation === 'NO_ENDLOC_PREFERENCE') delete d.errEndLocation;
															delete d.toLocKeyword;
															logger.info('User Preferences for User %s successfully updated', b.user.email);
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
		'departureTime': [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						function(d, b, i) {
							if (d.departureTime) {
								var cutoffTime = moment().add(CUTOFF_TIME, 'minutes');
								if (moment(d.departureTime).isAfter(cutoffTime)) return true;
								d.errDepartureTime = 'DEPARTURE_TOO_SOON';
							}
							return false;
						},
						function(d, b, i) {
							if(i.datetime) {
								b.touch = true;
								
								/*
								// align datetime with date information in expression if indicated
								if (i.datetime_from) {
									var d1 = moment(i.datetime),
										d2 = moment(i.datetime_from);
										
									var	d3 = i.datetime_to == undefined ? moment(d2).add(1, 'days') : moment(i.datetime_to);
									
									if (d1.isBefore(d2)) {
										var timediff = d2.subtract(d1).minutes();
										var timedelta = 720 - (timediff % 720);
										i.datetime = d2.add(timedelta, 'minutes').format();
										logger.debug('D1: %s, D2: %s, newtime: %s', d1, d2, i.datetime );
									} else if (d1.isAfter(d3)) {
										timediff = d1.subtract(d3).minutes();
										timedelta = 720 - (timediff % 720);
										i.datetime = d3.subtract(timedelta, 'minutes').format();
										logger.debug('D1: %s, D2: %s, newtime: %s', d3, d1, i.datetime );
									}	
								} else {
									// move forward if before now
									if (moment(i.datetime).isBefore(moment())) {
										d1 = moment(i.datetime);
										timediff = moment().subtract(d1).minutes();
										timedelta = 720 - (timediff % 720);
										i.datetime = moment().add(timedelta, 'minutes').format();
										logger.debug('D1: %s, Now: %s, newtime: %s', d1, d2, i.datetime );
									}
								}
								
								var cutoffTime = moment().add(90, 'minutes');
								if (moment(i.datetime).isAfter(cutoffTime)) {
									d.departureTime = i.datetime;
									return true;
								} 
								*/
								var nTime = normalizeTime(i);
								if (nTime) {
									d.departureTime = nTime;
									return true;
								}
								d.errDepartureTime = 'DEPARTURE_TOO_SOON';
								return false;
							}
							return false;
						},
						function(d, b, i) {
							if(i.datetime_to) {
								d.errDepartureTime = 'NON_SPECIFIC_TIME';
								b.touch = true;
							}
							return false;
						}
					],
		'confirmRequest' : [
						function(d, b, i) {
							return i.hasActiveRequest.then(function(active){
								if (active && !i.yes_no) b.touch = true;
								return active;
							});
						},
						function(d, b, i) {
							var state = b.context.state;
							if (state === 'RIDES_confirm_request' && i.yes_no === 'yes') b.touch = true;
							if (d.confirmNeed === false) return true; // exit validations if trip cancelled
							if ((state === 'RIDES_confirm_request' && i.yes_no === 'yes') || d.confirmRequest === true || d.confirmRequest === 'true') {
								return d.confirmRequest = true;
							}
							if ((state === 'RIDES_confirm_request' && i.yes_no === 'no') || d.confirmRequest === false || d.confirmRequest === 'false')  {
								d.confirmRequest = false;
								// d.errConfirmRequest = "CONFIRM_REQUEST_CANCEL";
								return false;
							}
							return false;
						}
					],
		'confirmSchedule' : [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (state === 'RIDES_confirm_schedule' && i.yes_no === 'yes') b.touch = true;
							if ((state === 'RIDES_confirm_schedule' && i.yes_no === 'yes') || d.confirmSchedule === true || d.confirmSchedule === 'true') {
								return d.confirmSchedule = true;
							}
							if ((state === 'RIDES_confirm_schedule' && i.yes_no === 'no') || d.confirmSchedule === false || d.confirmSchedule === 'false')  {
								d.confirmSchedule = false;
								// d.errConfirmRequest = "CONFIRM_REQUEST_CANCEL";
								return false;
							}
							return false;
						}
					],
		'infotype': [
						function(d, b, i) {
							if(i.infotype) {
								d.infotype = i.infotype;
								b.touch = true;
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
		'activeRequest' : function(user, clientHandle, data) {
						var responseText = getResponse(data, 'NO_ACTIVE_REQUEST');
						
						responseText = responseText.replace("@username", user.name);
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
						return false;
					},	
		'confirmNeed' : function(user, clientHandle, data) {
						if (!data.errConfirmNeed || errKeys.indexOf(data.errConfirmNeed) < 0) data.errConfirmNeed = 'NO_CONFIRM_NEED'; 
						var responseText = getResponse(data, data.errConfirmNeed);
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errConfirmNeed]);
						delete data.errConfirmNeed;
						return false;
					},	
		'startLong' : function(user, clientHandle, data) {
						if (data.errStartLocation === "CONFIRM_REQUEST_CANCEL") delete data.errStartLocation;
						if (!data.errStartLocation || errKeys.indexOf(data.errStartLocation) < 0) {
							data.errStartLocation = 'NO_START_LOCATION'; 
						}

						var responseText = getResponse(data, data.errStartLocation);

						responseText = responseText.replace("@lockeyword", data.fromLocKeyword);
						responseText = responseText.replace("@username", user.name);
						responseText = responseText.replace("@address", data.tempLocation);
						
						return getLocationLink(user.name, clientHandle).then(function(loclink){
							var replink = loclink != false ? loclink : '[Oops, missing link :thumbsdown:]';
							responseText = responseText.replace("@locationlink", replink);
							me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errStartLocation]);
							return false;
						});
					},
		'productId' : function(user, clientHandle, data) {
						if (!data.errProductId || errKeys.indexOf(data.errProductId) < 0) return true; 
						var responseText = getResponse(data, data.errProductId);
						responseText = responseText.replace("@username", user.name);
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errProductId]);
						if (data.errProductId === 'NO_PRODUCTS_AVAILABLE') data.cancelFlag = true; // fatal error, cancel
						delete data.errProductId;
						return false;
					},
		'endLong': function(user, clientHandle, data) {
						if (data.errEndLocation === "CONFIRM_REQUEST_CANCEL") delete data.errEndLocation;
						if (data.cancelFlagEL === true) {
							data.errEndLocation = "CONFIRM_REQUEST_CANCEL";
							delete data.cancelFlagEL;
						} else if (!data.errEndLocation || errKeys.indexOf(data.errEndLocation) < 0) {
							data.errEndLocation = 'NO_END_LOCATION'; 
						}

						var responseText = getResponse(data, data.errEndLocation);

						responseText = responseText.replace("@lockeyword", data.toLocKeyword);
						responseText = responseText.replace("@username", user.name);
						responseText = responseText.replace("@address", data.tempLocation);
						
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errEndLocation]);
						return false;
					},
		'departureTime' : function(user, clientHandle, data) {
						if (!data.errDepartureTime || errKeys.indexOf(data.errDepartureTime) < 0) data.errDepartureTime = 'NO_DEPARTURE_TIME'; 
						var responseText = getResponse(data, data.errDepartureTime);
						responseText = responseText.replace("@username", user.name);
							
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errDepartureTime]);
						delete data.errDepartureTime;
						return false;
					},
		'confirmSchedule' : function(user, clientHandle, data) {
						if (!data.errConfirmSchedule || errKeys.indexOf(data.errConfirmSchedule) < 0) data.errConfirmSchedule = 'NO_CONFIRM_SCHEDULE'; 
						var responseText = getResponse(data, data.errConfirmSchedule);
						var dateText = moment(data.departureTime).calendar();
						responseText = responseText.replace("@username", user.name);
						responseText = responseText.replace("@departureTime", dateText.toLowerCase());
							
						me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errConfirmSchedule]);
						delete data.errConfirmSchedule;
						return false;
					},
		'confirmRequest' : function(user, clientHandle, data) {
						/*if (data.cancelFlagCR === true) {
							data.errConfirmRequest = "CONFIRM_REQUEST_CANCEL";
							delete data.cancelFlagCR;
						} else */
						if (!data.errConfirmRequest || errKeys.indexOf(data.errConfirmRequest) < 0) {
							data.errConfirmRequest = 'NO_CONFIRM_REQUEST'; 
						}
						
						if (data.errConfirmRequest === 'CONFIRM_REQUEST_CANCEL') {
							var responseText = getResponse(data, data.errConfirmRequest);
							responseText = responseText.replace("@username", user.name);
							me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errConfirmRequest]);
							delete data.errConfirmRequest;
							return false;
						}

						// get ETA
						if (data.productId) {
							return getTimeEstimate(user.name, clientHandle, data).then(function (etas) {
								if (etas) {
									var jEtas = JSON.parse(etas);
									if (jEtas.times && jEtas.times.length > 0) {
										return getPriceEstimate(user.name, clientHandle, data).then(function (prices) {
											var jPrices = JSON.parse(prices);
											
											// price text
											var priceText = '';
											if (jPrices.prices && jPrices.prices.length > 0) priceText = 'for ' + jPrices.prices[0].estimate;
											
											// eta text
											var etaSecs = jEtas.times[0].estimate;
											var etaMins = Math.round(etaSecs / 60);
											var etaText = etaMins === 1 ? (etaMins + ' min') : (etaMins + ' mins');
											
											var responseText = getResponse(data, data.errConfirmRequest).replace("@username", user.name);
											responseText = responseText.replace("@eta", etaText);
											responseText = responseText.replace("@product_name", data.productName);
											responseText = responseText.replace("@price", priceText);

											var prefixText = '';
											if (data.noPreferred && data.carrier) {
												prefixText = 'No ' + data.carrier + ' available... ';
												delete data.noPreferred;
											}

											if (data.onlyUnPreferred && data.unCarrier) {
												prefixText += 'Only the ' + data.unCarrier + ' available at the moment. ';
												delete data.onlyUnPreferred;
											}

											responseText = prefixText + responseText;
											me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext[data.errConfirmRequest]);
											delete data.errConfirmRequest;
										});
									
									} else {
										// no available rides
										var responseText = getResponse(data, 'NO_RIDE_ETA');
										me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext['NO_RIDE_ETA']);
									}
									return false;
								} else {
									// no available rides
									responseText = getResponse(data, 'NO_RIDE_ETA');
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext['NO_RIDE_ETA']);
									return false;
								}
							});
						} else {
							return true;
						}

					},
		'infotype' : function(user, clientHandle, data) {
						me.emit('message', Rides.MODULE, user.name, clientHandle, 'What do you want to know?', Rides.MODULE + "_info_query");
						return false;
					},			
					
	};
	
	this.failover = {
		'rides_cancel_trip' : function(user, clientHandle, indata, data) {
								var responseText = getResponse(data, 'NOT_UNDERSTOOD');
								responseText = responseText.replace("@username", user.name);
								me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
								return true;
							},
		'rides_book_trip' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'no') {
									var responseText = getResponse(data, 'CONFIRM_REQUEST_CANCEL');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext['CONFIRM_REQUEST_CANCEL']);
									return false;
								} else if (indata.yes_no === 'yes') {
									responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return false;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_schedule_trip' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'no') {
									var responseText = getResponse(data, 'CONFIRM_REQUEST_CANCEL');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText, errorContext['CONFIRM_REQUEST_CANCEL']);
									return false;
								} else if (indata.yes_no === 'yes') {
									responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_get_cost' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'yes') {
									var responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_get_request_status' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'yes') {
									var responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_get_driver_info' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'yes') {
									var responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_get_vehicle_info' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'yes') {
									var responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_get_driver_location' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'yes') {
									var responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_get_eta' : function(user, clientHandle, indata, data) {
								if (indata.yes_no === 'yes') {
									var responseText = getResponse(data, 'POSITIVE_REINFORCEMENT');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								} else {
									responseText = getResponse(data, 'NOT_UNDERSTOOD');
									responseText = responseText.replace("@username", user.name);
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
									return true;
								}	
							},
		'rides_get_info' : function(user, clientHandle, indata, data) {
								var responseText = getResponse(data, 'NOT_UNDERSTOOD');
								responseText = responseText.replace("@username", user.name);
								me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
								return true;
							}					
	};

	this.handleRequest = {
		'rides_cancel_trip' : function(user, clientHandle, data) {
						if (data.confirmCancellation === true) {
							me.cancelRequest(user.name, clientHandle, data);
							return getActiveRequest(user.name, clientHandle).then(function(activeRequest) {
								if (activeRequest && activeRequest.status !== 'pending') {
									var rbody = { header: 'cancel_request', requestId: activeRequest.requestId };
									me.push(user, clientHandle, rbody);
								} else {
									me.emit('message', Rides.MODULE, user.name, clientHandle, 'Fine, your ride request has been cancelled');
									deleteActiveRequest(user.name, clientHandle);
								}	
								return true;							
							});
							
						} else {
							me.emit('message', Rides.MODULE, user.name, clientHandle, "You have no active ride requests to cancel");
							return false;
						}
					},
		'rides_get_cost' : function(user, clientHandle, data) {
						return getPriceEstimate(user.name, clientHandle, data).then(function (prices) {
							var jPrices = JSON.parse(prices);
							
							// price text
							if (jPrices.prices && jPrices.prices.length > 0) var priceText = 'An estimate for the ride is ' + jPrices.prices[0].estimate;
							var failureText = 'Sorry cannot retrieve an estimate for your ride at this time, try again later';
							var responseText = priceText == undefined ? failureText : priceText;
							
							me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
							return true;
						});
					},
		'rides_get_request_status' : function(user, clientHandle, data) {
						var rbody = { header : 'get_request_details', tag : 'query_request_status' };
						return getActiveRequest(user.name, clientHandle).then( function(activeRequest) {
							if (activeRequest && activeRequest.requestId) {
								rbody.requestId = activeRequest.requestId;
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'Let me check that for you...');
								me.push(user, clientHandle, rbody);
							} else {
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'Your request is still pending');
							}
							return true;
						});
					},
		'rides_get_driver_info' : function(user, clientHandle, data) {
						var rbody = { header : 'get_request_details', tag : 'query_driver_info' };
						return getActiveRequest(user.name, clientHandle).then( function(activeRequest) {
							if (activeRequest && activeRequest.requestId) {
								rbody.requestId = activeRequest.requestId;
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'Uno momento...');
								me.push(user, clientHandle, rbody);
							} else {
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'No driver has accepted your request yet, still pending');
							}
							return true;
						});
					},
		'rides_get_vehicle_info' : function(user, clientHandle, data) {
						var rbody = { header : 'get_request_details', tag : 'query_vehicle_info' };
						return getActiveRequest(user.name, clientHandle).then( function(activeRequest) {
							if (activeRequest && activeRequest.requestId) {
								rbody.requestId = activeRequest.requestId;
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'Let me see...');
								me.push(user, clientHandle, rbody);
							} else {
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'No ride has been assigned to you yet, still pending');
							}
							return true;
						});
					},
		'rides_get_driver_location' : function(user, clientHandle, data) {
						return getActiveRequest(user.name, clientHandle).then( function(activeRequest) {
							if (activeRequest && activeRequest.requestId) {
								var rbody = { header : 'get_request_details', tag : 'query_driver_location' };
								rbody.requestId = activeRequest.requestId;
								me.push(user, clientHandle, rbody);
							} else {
								return getTimeEstimate(user.name, clientHandle, data).then(function (etas) {
									if (etas) {
										var jEtas = JSON.parse(etas);
										if (jEtas.times && jEtas.times.length > 0) {	
												// eta text
												var etaSecs = jEtas.times[0].estimate;
												var etaMins = Math.round(etaSecs / 60);
												var etaText = etaMins === 1 ? (etaMins + ' min') : (etaMins + ' mins');
												
												var responseText = 'The nearest @product_name is @eta away';
												responseText = responseText.replace("@eta", etaText);
												responseText = responseText.replace("@product_name", data.productName);
												
												var prefixText = '';
												if (data.noPreferred && data.carrier) {
													prefixText = 'No ' + data.carrier + ' available... ';
													var userkey = getUserKey(user.name, clientHandle);
													cache.hdel(userkey + ':payload', 'noPreferred');
												}
	
												if (data.onlyUnPreferred && data.unCarrier) {
													prefixText += 'Only the ' + data.unCarrier + ' available at the moment. ';
													userkey = getUserKey(user.name, clientHandle);
													cache.hdel(userkey + ':payload', 'onlyUnPreferred');
												}
												
												responseText = prefixText + responseText;
												me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
										
										} else {
											// no available rides
											responseText = 'No available rides around you at the moment';
											me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
										}
									} else {
										// no available rides
										responseText = 'No available rides around you at the moment';
										me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
										return false;
									}
								});
							}
							return true;
						});
					},
		'rides_get_eta' : function(user, clientHandle, data) {
						return getActiveRequest(user.name, clientHandle).then( function(activeRequest) {
							if (activeRequest && activeRequest.requestId) {
								var rbody = { header : 'get_request_details', tag : 'query_request_eta' };
								rbody.requestId = activeRequest.requestId;
								me.push(user, clientHandle, rbody);
							} else {
								return getTimeEstimate(user.name, clientHandle, data).then(function (etas) {
									if (etas) {
										var jEtas = JSON.parse(etas);
										if (jEtas.times && jEtas.times.length > 0) {	
												// eta text
												var etaSecs = jEtas.times[0].estimate;
												var etaMins = Math.round(etaSecs / 60);
												var etaText = etaMins === 1 ? (etaMins + ' min') : (etaMins + ' mins');
												
												var responseText = 'The nearest @product_name is @eta away';
												responseText = responseText.replace("@eta", etaText);
												responseText = responseText.replace("@product_name", data.productName);
												
												var prefixText = '';
												if (data.noPreferred && data.carrier) {
													prefixText = 'No ' + data.carrier + ' available... ';
													var userkey = getUserKey(user.name, clientHandle);
													cache.hdel(userkey + ':payload', 'noPreferred');
												}
	
												if (data.onlyUnPreferred && data.unCarrier) {
													prefixText += 'Only the ' + data.unCarrier + ' available at the moment. ';
													userkey = getUserKey(user.name, clientHandle);
													cache.hdel(userkey + ':payload', 'noPreferred');
												}
												
												responseText = prefixText + responseText;
												me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
										
										} else {
											// no available rides
											responseText = 'No available rides around you at the moment';
											me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
										}
									} else {
										// no available rides
										responseText = 'No available rides around you at the moment';
										me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
										return false;
									}
								});
							}
							return true;
						});
					},
		'rides_book_trip' : function(user, clientHandle, data) {
						var userkey = getUserKey(user.name, clientHandle);
						logger.debug('HandleRequest: handling for rides_book_trip... %s', JSON.stringify(data));
						if (data.confirmNeed === false) {
							logger.debug('HandleRequest: handling for rides_book_trip...calling cancelrequest');
							me.cancelRequest(user.name, clientHandle, data);
							return true;
						} else {
							// check if there's an active request
							return getActiveRequest(user.name, clientHandle).then(function(request) {
								if (request && request.status) {
									switch (request.status) {
										case 'pending':
											var responseText = 'You already have an active request, hold on while I process it...';
											break;
										case 'processing':
											responseText = 'I\'ve already booked a request for you...waiting for a driver to confirm';
											break;
										case 'accepted':
											responseText = 'Your ride is already on its way';
											break;
										case 'arriving':
											responseText = 'Your ride should be here. Go check';
											break;
										case 'in_progress':
											responseText = 'Unless I\'m mistaken, you should be on a ride at the moment';
											break;
										default:
											responseText = 'You can wrap it up and book another';
									}
									me.emit('message', Rides.MODULE, user.name, clientHandle, responseText);
								} else {
									me.emit('message', Rides.MODULE, user.name, clientHandle, 'One second, let me see...');
									data.header = 'request_ride';
									me.push(user, clientHandle, data);
									
									// set active request in cache
									var newRequest = {
										timestamp : new Date().getTime(),
										status    : 'pending'
									};
									cache.hmset(userkey + ':activerequest', newRequest);
								}
								return true;
							});
						}
					},
		'rides_schedule_trip' : function(user, clientHandle, data) {
						var userkey = getUserKey(user.name, clientHandle);
						logger.debug('HandleRequest: handling for rides_schedule_trip... %s', JSON.stringify(data));
						// check if there's an active request
						return checkActiveRequest(user.name, clientHandle).then(function(active) {
							if (active) {
								// tell user she has an active request...need to complete before booking
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'You already have another request active. Complete it before scheduling your ride');
							} else {
								data.header = 'scheduled_trip';
								var body = { 'module': Rides.MODULE, 'user': user, 'client': clientHandle, 'data': data };
								var scheduleTime = moment(data.departureTime).subtract(30, 'minutes'); // Prompt 30 minutes earlier
								
								// call the scheduler
								/*
								scheduler.add(scheduleTime.toDate().getTime(), body, mq.CONTROLLER_INBOUND).then (function(eventId) {
									cache.zadd(userkey + ':scheduledrequests', scheduleTime.toDate().getTime(), eventId); //possibly make a then
									me.emit('message', Rides.MODULE, user.name, clientHandle, 'Done, i\'ll notify you when its time to call the ride...');
								});
								*/	
								me.emit('message', Rides.MODULE, user.name, clientHandle, 'Done, i\'ll follow up with you when its time to call the ride...');
								cache.del(userkey + ':payload');
							}
							return true;
						});
					},
		'rides_get_info' : function(user, clientHandle, data) {
						me.emit('message', Rides.MODULE, user.name, clientHandle, 'You want to know ' + data.infotype);
						return true;
					}
	};

}


function normalizeTime(i) {
	if (i.datetime_from) {
		var d1 = moment(i.datetime),
			d2 = moment(i.datetime_from);
			
		var	d3 = i.datetime_to == undefined ? moment(d2).add(1, 'days') : moment(i.datetime_to);
		
		if (d1.isBefore(d2)) {
			var timediff = d2.diff(d1, 'minutes');
			var timedelta = 720 - (timediff % 720);
			i.datetime = d2.add(timedelta, 'minutes').format();
			logger.debug('D1: %s, D2: %s, newtime: %s, timediff: %s, timedelta: %s', d1, d2, i.datetime, timediff, timedelta );
		} else if (d1.isAfter(d3)) {
			timediff = d1.diff(d3, 'minutes');
			timedelta = 720 - (timediff % 720);
			i.datetime = d3.subtract(timedelta, 'minutes').format();
			logger.debug('D3: %s, D1: %s, newtime: %s, timediff: %s, timedelta: %s', d3, d1, i.datetime, timediff, timedelta );
		}	
	} else {
		// move forward if before now
		if (moment(i.datetime).isBefore(moment())) {
			d1 = moment(i.datetime);
			timediff = moment().diff(d1, 'minutes');
			timedelta = 720 - (timediff % 720);
			i.datetime = moment().add(timedelta, 'minutes').format();
			logger.debug('D1: %s, Now: %s, newtime: %s', d1, d2, i.datetime );
		}
	}
	
	var cutoffTime = moment().add(CUTOFF_TIME, 'minutes');
	if (moment(i.datetime).isAfter(cutoffTime)) return i.datetime;
	return false;
}


function checkActiveRequest(username, clientHandle) {
	var userkey = getUserKey(username, clientHandle);
	return cache.hgetall(userkey + ':activerequest').then(function(request) {
		if (!request) {
			return false;
		} else {
			return true;
		}
	});
}

function getActiveRequest(username, clientHandle) {
	var userkey = getUserKey(username, clientHandle);
	return cache.hgetall(userkey + ':activerequest');
}

function deleteActiveRequest(username, clientHandle) {
	var userkey = getUserKey(username, clientHandle);
	cache.del(userkey + ':activerequest');
}

function cacheActiveRequest(username, clientHandle, data) {
	var userkey = getUserKey(username, clientHandle);

	var activeRequest = {
		request_id : data.requestId,
		status : data.status,
		eta    : data.eta
	};
	if (data.vehicle) activeRequest.vehicle = JSON.stringify(data.vehicle);
	if (data.driver) activeRequest.driver = JSON.stringify(data.driver);
	if (data.location) activeRequest.location = JSON.stringify(data.location);
	if (data.href) activeRequest.href = data.href;

	cache.hmset(userkey + ':activerequest', activeRequest);
}



function getHandlerEndpoint(username, clientHandle) {
	var userkey = getUserKey(username, clientHandle);
	return cache.hget(userkey + ':handler', 'endpoint_base').then(function(endpoint) {
		if (!endpoint) {
			return false;
		} else {
			return endpoint;
		}
	});
}

function getProducts(username, clientHandle, data) {
	return getHandlerEndpoint(username, clientHandle).then (function (endpoint) {
		if (endpoint) {
			logger.debug('getProducts->endpoint: %s', endpoint);
			var resource = '/v1/products' ;
		    var requrl = {
		        url : endpoint + resource,
		        method : 'get',
		        qs : {
		            'lat': data.startLat,
		            'lng' : data.startLong
		        }
		    };    
		    return request(requrl);
		} else {
			return false;
		}
	});
}

function getTimeEstimate(username, clientHandle, data) {
	return getHandlerEndpoint(username, clientHandle).then (function (endpoint) {
		if (endpoint) {
			logger.debug('getTimeEstimate->endpoint: %s', endpoint);
			var resource = '/v1/estimates/time' ;
		    var requrl = {
		        url : endpoint + resource,
		        method : 'get',
		        qs : {
		            'lat': data.startLat,
		            'lng' : data.startLong
		        }
		    };
		    if (data.productId) requrl.qs.product_id = data.productId;    
		    return request(requrl);
		} else {
			return false;
		}
	});
}

function getPriceEstimate(username, clientHandle, data) {
	return getHandlerEndpoint(username, clientHandle).then (function (endpoint) {
		if (endpoint) {
			logger.debug('getPriceEstimate->endpoint: %s', endpoint);
			var resource = '/v1/estimates/price' ;
		    var requrl = {
		        url : endpoint + resource,
		        method : 'get',
		        qs : {
		            'product_id': data.productId,
		            'slat': data.startLat,
		            'slng' : data.startLong,
		            'elat': data.endLat,
		            'elng' : data.endLong
		        }
		    };
		    return request(requrl);
		} else {
			return false;
		}
	});
}

function getTimeEstimateAll(username, clientHandle, data) {
	return getHandlerEndpoint(username, clientHandle).then (function (endpoint) {
		if (endpoint) {
			logger.debug('getTimeEstimateAll->endpoint: %s', endpoint);
			var resource = '/v1/estimates/time' ;
		    var requrl = {
		        url : endpoint + resource,
		        method : 'get',
		        qs : {
		            'lat': data.startLat,
		            'lng' : data.startLong
		        }
		    };
		    return request(requrl);
		} else {
			return false;
		}
	});
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
		var jsonData = JSON.parse(data);
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
	var me = this;
	
	checkActiveRequest(user.name, client.slackHandle).then(function(activeRequest) {
		if (body.outcomes[0].intent === 'rides_cancel_trip' || body.outcomes[0].intent === 'default_cancel_request') {
			var handlerTodo = 'rides_cancel_trip';
			body.touch = true;  // confirms the statement is understood
		} else if (body.context.state === 'RIDES_confirm_cancellation' && body.outcomes[0].intent !== 'rides_request_trip') {
			handlerTodo = 'rides_cancel_trip';
			body.touch = true;
		} else if (activeRequest && body.outcomes[0].intent === 'default_reject') {
			handlerTodo = 'rides_cancel_trip';
			body.touch = true;
		} else if (body.outcomes[0].intent === 'rides_schedule_trip') {
			handlerTodo = 'rides_schedule_trip';
			body.touch = true;
		} else if (body.outcomes[0].intent === 'rides_request_trip' || body.outcomes[0].intent === 'rides_go_out') {
			handlerTodo = 'rides_book_trip';
			body.touch = true;
		} else if (body.outcomes[0].intent === 'rides_info_query' || body.context.state === 'RIDES_info_query' ) {
			handlerTodo = 'rides_get_info';
			body.touch = true;
		} else if (activeRequest) {
			handlerTodo = 'rides_book_trip';
		} else if (body.context.state === 'RIDES_confirm_ride_needed' || body.context.state === 'RIDES_confirm_request') {
			handlerTodo = 'rides_book_trip';
		} else if (body.context.state === 'RIDES_confirm_schedule') {
			handlerTodo = 'rides_schedule_trip';
		}
		
		logger.debug('HandlerTodo->First Cut: %s', handlerTodo);
		if (body.outcomes[0].intent === 'default_prompt' || body.outcomes[0].intent === 'confused') body.touch = true;
		
		if (handlerTodo === 'rides_get_info') {
			var infoQuery = getInfoQuery(body);
			handlerTodo = infoQuery == undefined ? handlerTodo : infoQuery;
		}
		
		logger.debug('HandlerTodo->2nd Cut (getInfoQuery): %s', handlerTodo);
		logger.debug('Body Touched?: %s', body.touch);
		
		resolveBookOrSchedule(user.name, client.slackHandle, body, handlerTodo).then(function(htd) {
			logger.debug('HandlerTodo->3rd Cut (resolveBookOrSchedule): %s', htd);
			me.processData(user, client.slackHandle, body, htd);  
		});
		
	});	
}


function getInfoQuery(body) {
	if (body.outcomes[0].entities.infotype) {
		var infotype = body.outcomes[0].entities.infotype[0].value;
		if (infotype) body.touch = true;
		logger.debug('GetInfoQuery->Infotype: %s', infotype);
		switch (infotype) {
			case 'location':
				return 'rides_get_driver_location';
				break;
			case 'cost':
				return 'rides_get_cost';
				break;
			case 'request_status':
				return 'rides_get_request_status';
				break;
			case 'contact_info':
				return 'rides_get_driver_info';
				break;
			case 'vehicle_info':
				return 'rides_get_vehicle_info';
				break;
			case 'time':
				return 'rides_get_eta';
				break;
			default:
				return 'rides_get_request_status';
		}		
	} else {
		return false;
	}
}


function resolveBookOrSchedule(username, clientHandle, body, handlerTodo) {
	var userkey = getUserKey(username, clientHandle);
	if (handlerTodo === 'rides_book_trip' || handlerTodo === 'rides_schedule_trip') {
		return checkActiveRequest(username, clientHandle).then( function(active){
			if (active) return handlerTodo;
			return cache.hget(userkey + ':payload', 'departureTime').then(function(dTime) {
				if (body.outcomes[0].entities.datetime || dTime) {
					if (body.outcomes[0].entities.datetime) {
						var i = extractEntities(body);
						if (normalizeTime(i)) return 'rides_schedule_trip';
					} else {
						if (moment(dTime).isAfter(moment().add(CUTOFF_TIME, 'minutes'))) return 'rides_schedule_trip';
					}
				}
				return 'rides_book_trip';
			});	
		}); 
	} else {
		return when(handlerTodo);
	}
}


function validateHandlerTodo(username, clientHandle, handlerTodo) {
	var userkey = getUserKey(username, clientHandle);
	if (handlerTodo) {
		return when(handlerTodo);
	} else {
		return cache.hget(userkey + ':payload', 'handlerTodo').then(function(htd) {
			if (!htd) {
				return 'rides_book_trip';
			} else {
				return htd; // return previous handlerTodo if exists
			}
		});
	}
}


Rides.prototype.refreshHandlerEndpoint = function(user, clientHandle) {
	var me = this;
	var userkey = getUserKey(user.name, clientHandle);
	return cache.hget(userkey + ':handler', 'endpoint_base').then(function(endpoint) {
		if (!endpoint) {
			var body = { header: 'get_endpoint_base' };
			me.push(user, clientHandle, body);
			return false;
		} else {
			return endpoint;
		}
	});
}

/**
 * Validate data sufficiency and trigger request to endpoint
 * @param user - the user making the request
 * @param client - the company that owns this message
 * @param body - JSON object with request details
 */
Rides.prototype.processData = function(user, clientHandle, body, htd) {
    var me = this;
    var username = user.name;
	var userkey = getUserKey(username, clientHandle);
	
	this.refreshHandlerEndpoint(user, clientHandle);
	

	var indata = extractEntities(body);
	indata.hasActiveRequest = checkActiveRequest(username, clientHandle);

	if (body.outcomes) {
		if (body.outcomes[0].intent === 'default_accept') indata.yes_no = 'yes';
		if (body.outcomes[0].intent === 'default_reject') indata.yes_no = 'no';
	}

	body.user = user;
	body.clientHandle = clientHandle;

	validateHandlerTodo(user.name, clientHandle, htd).then (function (handlerTodo) {	
		logger.debug('HandlerTodo->Final Cut (validateHandlerTodo): %s', handlerTodo);
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
												if (!missingData && body.touch) {
													// data is complete and valid
													logger.debug('No more missing data: calling handleRequest for %s', handlerTodo);
													me.handleRequest[handlerTodo](user, clientHandle, datahash);
													
												} else {
													if (datahash.cancelFlag) me.cancelRequest(user.name, clientHandle, datahash);
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
			cache.expire(userkey + ':payload', CONTEXT_TTL);
			cache.expire(userkey + ':datacheck', CONTEXT_TTL);	
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
						
	var userkey = getUserKey(username, clientHandle);

    cache.del(userkey + ':payload');
    cache.del(userkey + ':datacheck');
    //cache.del(userkey + ':activerequest'); // for now. Change to send handler request
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
	var userkey = getUserKey(username, clientHandle);

	// check for message uniqueness
	if (this.msgid !== msgid) {
		switch (body.header) {
			case 'geo_data':
				setUserGeoData(username, clientHandle, body);
				logger.debug('Done setting user geodata...');

				geo.getGeoStaticMapLink(body.lat, body.longt).then (function (mapLink) {
					me.emit('message', Rides.MODULE, username, clientHandle, 'Thanks, I have your location \n' + mapLink);

					//refresh dialog
					cache.hgetall(username + '@' + clientHandle).then(function(user){
						var rbody = { context: { state : Rides.MODULE }, touch: true };
						getAddressByCoords(body.lat, body.longt).then (function(address) {
							logger.debug('Address: %s', address);
							if (address) rbody.outcomes = [{ 'entities': { 'geofrom': [{"value": address}] }}];
							if (user) me.processData(user, clientHandle, rbody);
						});
						
					});
				});
				break;
			case 'scheduled_trip':
				setUserPayload(username, clientHandle, body);
				logger.debug('Done setting user payload...');

				me.emit('message', Rides.MODULE, username, clientHandle, 'You have a pickup scheduled for 30 mins from now, do you still need the ride?', 'RIDES_confirm_ride_needed');

				break;
			case 'auth_link':
				utils.shortenLink(body.authLink).then (function(shortAuthLink) {
					me.emit('message', Rides.MODULE, username, clientHandle, 'I need authorization to your ' + body.handler + ' account. Click here to authorize: ' + shortAuthLink);
				});
				break;
			case 'auth_ack':
				me.emit('message', Rides.MODULE, username, clientHandle, 'Thanks @' + username + '. Now hold on a minute...');
				break;
			case 'surge_link':
				var surgeMessage = 'Surge pricing is in effect and your trip will cost more than usual. Click here to review and accept: ';
				utils.shortenLink(body.surgeLink)
					.then (function(shortSurgeLink) {
						me.emit('message', Rides.MODULE, username, clientHandle, surgeMessage + shortSurgeLink);
					}).catch(function(){
						if (body.surgeLink) {
							me.emit('message', Rides.MODULE, username, clientHandle, surgeMessage + body.surgeLink);	
						} else {
							me.emit('message', Rides.MODULE, username, clientHandle, "Sorry can't get you a ride at this time. Please try again in a little bit", " ");
							me.cancelRequest(username, clientHandle, {});
							deleteActiveRequest(username, clientHandle);
						}
					});
				break;
			case 'surge_ack':
				me.emit('message', Rides.MODULE, username, clientHandle, 'Thanks @' + username + '. Now hold on a minute...');
				break;
			case 'endpoint_base':
				cache.hset(userkey + ':handler', 'endpoint_base', body.endpoint);
				cache.expire(userkey + ':handler', ONE_DAY_TTL);
				break;
			case 'request_response':
				me.processRequestUpdate(username, clientHandle, body);	
				break;	
			case 'request_cancel':
				me.emit('message', Rides.MODULE, username, clientHandle, "Your ride has been canceled", " ");
				me.cancelRequest(username, clientHandle, {});
				deleteActiveRequest(username, clientHandle);
				break;	
			case 'request_error':
				me.processRequestError(username, clientHandle, body);	
				break;	
			case 'request_details':
				me.processRequestUpdate(username, clientHandle, body);	
				break;	
			case 'request_details_hook':
				getActiveRequest(username, clientHandle).then(function(activeRequest) {
					if (activeRequest && !(activeRequest.status === body.status && body.header === 'request_details_hook')) {
						me.processRequestUpdate(username, clientHandle, body);
					}
				});
				break;	
			case 'query_request_status':
				cacheActiveRequest(username, clientHandle, body);	
				if (body.status === 'accepted') {
					if (body.driver) {
						var acceptedMessage = body.driver.name + ' (' + body.driver.rating +' stars) will be there in ' + body.eta + ' minutes in a ' + body.vehicle.make + ' ' + body.vehicle.model;
						acceptedMessage += ', registration ' + body.vehicle.license_plate + '. \nYou can reach him on ' + body.driver.phone_number;
						me.emit('message', Rides.MODULE, username, clientHandle, acceptedMessage);
						if (body.href) me.emit('message', Rides.MODULE, username, clientHandle, body.href);
						//if (body.driver.picture_url != null) me.emit('message', Rides.MODULE, username, clientHandle, body.driver.picture_url);
					} else {
						me.emit('message', Rides.MODULE, username, clientHandle, 'Your ride is on its way...');	
					}
				} else {
					me.processRequestQuery(username, clientHandle, body);
				}
				break;	
			case 'query_driver_info':
				cacheActiveRequest(username, clientHandle, body);	
				if (body.status === 'accepted') {
					if (body.driver) {
						acceptedMessage = 'Your driver is ' + body.driver.name + ' (' + body.driver.rating +' stars). He\'ll be there in ' + body.eta + ' minutes. \nYou can reach him on ' + body.driver.phone_number;
						me.emit('message', Rides.MODULE, username, clientHandle, acceptedMessage);
						if (body.driver.picture_url != null) {
							utils.shortenLink(body.driver.picture_url).then(function(driverPicLink){
								me.emit('message', Rides.MODULE, username, clientHandle, driverPicLink);
							}).catch(function(error){
								me.emit('message', Rides.MODULE, username, clientHandle, body.driver.picture_url);	
							});	
						}
					} else {
						me.emit('message', Rides.MODULE, username, clientHandle, 'Your ride should soon be on its way...can\'t get your driver\'s details just yet');	
					}
				} else {
					me.processRequestQuery(username, clientHandle, body);
				}
				break;	
			case 'query_vehicle_info':
				cacheActiveRequest(username, clientHandle, body);	
				if (body.status === 'accepted') {
					if (body.vehicle) {
						acceptedMessage = 'Your ride is a ' + body.vehicle.make + ' ' + body.vehicle.model + ' driven by ' + body.driver.name + ' (' + body.driver.rating +' stars). He should be there in ' + body.eta + ' minutes. \nHis cell is ' + body.driver.phone_number;
						me.emit('message', Rides.MODULE, username, clientHandle, acceptedMessage);
						if (body.vehicle.picture_url != null) {
							utils.shortenLink(body.vehicle.picture_url).then(function(vehiclePicLink){
								me.emit('message', Rides.MODULE, username, clientHandle, vehiclePicLink);
							}).catch(function(error){
								me.emit('message', Rides.MODULE, username, clientHandle, body.vehicle.picture_url);	
							});	
						}
					} else {
						me.emit('message', Rides.MODULE, username, clientHandle, 'Your ride should soon be on its way...can\'t get your vehicle details just yet');	
					}
				} else {
					me.processRequestQuery(username, clientHandle, body);
				}	
				break;	
			case 'query_driver_location':
				cacheActiveRequest(username, clientHandle, body);	
				if (body.status === 'accepted') {
					if (body.driver) {
						acceptedMessage = body.driver.name + ' is ' + body.eta + ' minutes away';
						me.emit('message', Rides.MODULE, username, clientHandle, acceptedMessage);
						if (body.href) me.emit('message', Rides.MODULE, username, clientHandle, body.href);
						//if (body.driver.picture_url != null) me.emit('message', Rides.MODULE, username, clientHandle, body.driver.picture_url);
					} else {
						me.emit('message', Rides.MODULE, username, clientHandle, 'Your ride should soon be on its way...can\'t get your driver\'s details just yet');	
					}
				} else {
					me.processRequestQuery(username, clientHandle, body);
				}
				break;	
			case 'query_request_eta':
				cacheActiveRequest(username, clientHandle, body);	
				if (body.status === 'accepted') {
					if (body.eta) {
						acceptedMessage = 'Your ride should be there in ' + body.eta + ' mins';
						me.emit('message', Rides.MODULE, username, clientHandle, acceptedMessage);
					} else {
						me.emit('message', Rides.MODULE, username, clientHandle, 'Your ride should soon be on its way...can\'t get an ETA at the moment');	
					}
				} else {
					me.processRequestQuery(username, clientHandle, body);
				}
				break;	
		}
		this.msgid = msgid;
	}
		
}

Rides.prototype.processRequestUpdate = function(username, clientHandle, body) {
	var me = this;
	cacheActiveRequest(username, clientHandle, body);
	switch (body.status) {
		case 'processing':
			me.emit('message', Rides.MODULE, username, clientHandle, 'Waiting for a driver\'s confirmation...');
			break;
		case 'accepted':
			if (body.driver) {
				var acceptedMessage = body.driver.name + ' (' + body.driver.rating +' stars) will be there in ' + body.eta + ' minutes in a ' + body.vehicle.make + ' ' + body.vehicle.model + ', registration ' + body.vehicle.license_plate + '. \nYou can reach him on ' + body.driver.phone_number;
				me.emit('message', Rides.MODULE, username, clientHandle, acceptedMessage);
				if (body.href) me.emit('message', Rides.MODULE, username, clientHandle, body.href);
				//if (body.driver.picture_url != null) me.emit('message', Rides.MODULE, username, clientHandle, body.driver.picture_url);
			} else {
				me.emit('message', Rides.MODULE, username, clientHandle, 'Your ride is on its way...');	
			}
			break;
		case 'arriving':
			me.emit('message', Rides.MODULE, username, clientHandle, "Your ride has arrived");
			if (body.href) me.emit('message', Rides.MODULE, username, clientHandle, body.href);
			break;
		case 'no_drivers_available':
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry, no drivers available", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'in_progress':
			break;
		case 'driver_canceled':
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry, the driver canceled...", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'rider_canceled':
			me.emit('message', Rides.MODULE, username, clientHandle, "Your ride has been canceled", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'completed':
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
	}
}

Rides.prototype.processRequestQuery = function(username, clientHandle, body) {
	var me = this;
	switch (body.status) {
		case 'processing':
			me.emit('message', Rides.MODULE, username, clientHandle, 'Still waiting for a driver\'s confirmation...');
			break;
		case 'arriving':
			me.emit('message', Rides.MODULE, username, clientHandle, "Your ride has arrived");
			if (body.href) me.emit('message', Rides.MODULE, username, clientHandle, body.href);
			break;
		case 'no_drivers_available':
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry, no drivers available", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'in_progress':
			me.emit('message', Rides.MODULE, username, clientHandle, "You're on your way my friend");
			break;
		case 'driver_canceled':
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry, the driver canceled...", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'rider_canceled':
			me.emit('message', Rides.MODULE, username, clientHandle, "Your ride has been canceled", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'completed':
			me.emit('message', Rides.MODULE, username, clientHandle, "Your ride is completed", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
	}
}

Rides.prototype.processRequestError = function(username, clientHandle, body) {
	var me = this;
	switch (body.status) {
		case 'no_drivers_available':
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry, no drivers available", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'driver_canceled':
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry, the driver canceled...", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'create_error':
			var errRunnerMessage = body.title != false ? body.title : 'Try again later';
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry @" + username + " can't find you a ride at the moment. " + errRunnerMessage, " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'retrieve_error':
			errRunnerMessage = body.title != false ? body.title : 'Try again later';
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry @" + username + " can't get the info you need at the moment. " + errRunnerMessage, " ");
			break;
	}
}

/**
 * Push a message to the message exchange for a handler to pick up
 * @param clientHandle - handle of the company that owns this message
 * @param message - JSON object with message to be processed by the handler
 */
Rides.prototype.push = function(user, clientHandle, body) {
	var data = {  'id': new Date().getTime(), 'user': user, 'client': clientHandle, 'body': body };
	logger.info('%s Processor: Connecting to MQ Exchange <piper.events.out>...', Rides.MODULE);
	var me = this;
	this.pub.connect('piper.events.out', function() {
		logger.info('%s Processor: <piper.events.out> connected', Rides.MODULE);
		me.pub.publish(Rides.MODULE.toLowerCase() + '.' + clientHandle, JSON.stringify(data));
	});
}

function setUserGeoData(username, clientHandle, body) {
	var userkey = getUserKey(username, clientHandle);
	cache.hset(userkey + ':payload', 'startLat', body.lat);
	cache.hset(userkey + ':payload', 'startLong', body.longt);
}


function setUserPayload(username, clientHandle, body) {
	var userkey = getUserKey(username, clientHandle);
	cache.hmset(userkey + ':payload', body);
}


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

function getLocationByAddress(address) {
	return geo.getCode(address).then(function(data){
		logger.info('Geo data: ' + JSON.stringify(data));
		if (data.status === 'OK' && data.results[0].geometry.location.lng) {
			return {longt : data.results[0].geometry.location.lng, lat : data.results[0].geometry.location.lat };
		} else {
			return false;
		}
	});
	// return when({longt : 1, lat: 1});
}

function getAddressByCoords(lat, lng) {
	return geo.getReverseCode(lat, lng).then(function(data){
		//logger.info('Geo data: ' + JSON.stringify(data));
		if (data.status === 'OK' && data.results[0].formatted_address) {
			return data.results[0].formatted_address;
		} else {
			return false;
		}
	});
	// return when({longt : 1, lat: 1});
}

function getResponse(data, errorMsg) {
	if (!data.lvlQueries) data.lvlQueries = {};
	if (!data.lvlQueries[errorMsg] || isNaN(data.lvlQueries[errorMsg])) data.lvlQueries[errorMsg] = 0;
	while (!responses[errorMsg][data.lvlQueries[errorMsg]] && data.lvlQueries[errorMsg] > 0) data.lvlQueries[errorMsg]--;
	
	var responseText = responses[errorMsg][data.lvlQueries[errorMsg]] ? responses[errorMsg][data.lvlQueries[errorMsg]] : "I'm a bit confused..."; 
	data.lvlQueries[errorMsg]++; 
	return responseText;
}

function getLocationKeyword(location) {
	if ((location.match(/\d+/g) != null)) return false; // reject if location contains a number
	
	var reqkey = false;

	var lkKeys = Object.keys(keywords.locations);
	//logger.debug('lkKeys: %s', lkKeys);		
	lkKeys.forEach(function(lkKey) {
		var keywordList = keywords.locations[lkKey];
		logger.debug('keywordList: %s', keywordList);
		keywordList.forEach(function(keyword) {
	//		logger.debug('location.search(%s): %s', keyword, location.search(keyword));
			if (location.search(keyword) > -1 && location.length < keyword.length + 4) {
				reqkey = lkKey;
			}
		});
	});
	return reqkey;
}

function setTerminal(d, b, i) {
	var terminalSet = false;
	if (i.location) b.touch = true;
	
	// state selection...
	var state = b.context.state;
	switch (state) {
		case 'RIDES_get_start_location':
			if (!i.from) {
				i.from = i.location;
				d.currLocation = START_LOC; 
			} else if (!i.to) {
				i.to = i.location;
				d.currLocation = END_LOC; 
			}
			terminalSet = true;
			break;
		case 'RIDES_get_startloc_preference':
			if (!i.from) {
				i.from = i.location;
				d.currLocation = START_LOC; 
			} else if (!i.to) {
				i.to = i.location;
				d.currLocation = END_LOC; 
			}
			terminalSet = true;
			break;
		case 'RIDES_get_end_location':
			if (!i.to) {
				i.to = i.location;
				d.currLocation = END_LOC; 
			} else if (!i.from) {
				i.from = i.location;
				d.currLocation = START_LOC;
			}
			terminalSet = true;
			break;
		case 'RIDES_get_endloc_preference':
			if (!i.to) {
				i.to = i.location;
				d.currLocation = END_LOC; 
			} else if (!i.from) {
				i.from = i.location;
				d.currLocation = START_LOC;
			}
			terminalSet = true;
			break;
		case 'RIDES_confirm_start_location':
			logger.debug('Got here 1');
			if (i.yes_no === 'yes') {
				logger.debug('Got here 2');
				i.from = d.tempLocation;
				d.currLocation = START_LOC;
				if (d.errStartLocation === 'SUSPECT_START_LOCATION') delete d.errStartLocation;
				delete d.tempLocation;
				terminalSet = true;
				b.touch = true;
			} else if (i.yes_no === 'no') {
				i.to = d.tempLocation;
				d.currLocation = END_LOC;
				delete d.tempLocation;
				terminalSet = true;
				if (d.errStartLocation === 'SUSPECT_START_LOCATION') delete d.errStartLocation;
				b.touch = true;
			} else {
				delete d.tempLocation;
				if (d.errStartLocation === 'SUSPECT_START_LOCATION') delete d.errStartLocation;
			}
			break;
		case 'RIDES_confirm_end_location':
			logger.debug('Got here 1');
			if (i.yes_no === 'yes') {
				logger.debug('Got here 2');
				i.to = d.tempLocation;
				d.currLocation = START_LOC;
				if (d.errEndLocation === 'SUSPECT_END_LOCATION') delete d.errEndLocation;
				delete d.tempLocation;
				terminalSet = true;
				b.touch = true;
			} else if (i.yes_no === 'no') {
				i.from = d.tempLocation;
				d.currLocation = END_LOC;
				delete d.tempLocation;
				terminalSet = true;
				if (d.errEndLocation === 'SUSPECT_END_LOCATION') delete d.errEndLocation;
				b.touch = true;
			} else {
				delete d.tempLocation;
				if (d.errEndLocation === 'SUSPECT_END_LOCATION') delete d.errEndLocation;
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

	// Check for outstanding item and extract suspicions
	if (!terminalSet) {
		if (d.startLong && d.startLong != 0 && (!d.endLong || d.endLong == 0)) {
			//Suspect End Location
			d.errEndLocation = 'SUSPECT_END_LOCATION';
		} else {
			// Suspect Start Location
			d.errStartLocation = 'SUSPECT_START_LOCATION';
		}
		if (i.location) d.tempLocation = i.location;
	}


}


function getLocationLink(username, clientHandle){
	return utils.getUserLocationLink(username, clientHandle, Rides.MODULE);
	
}

module.exports = Rides;



