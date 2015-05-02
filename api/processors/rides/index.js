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
var request = require('request-promise');
var geo = require('./lib/geo');

var CACHE_PREFIX = 'rides:';
var MSGKEYS_TTL = 300;
var CONTEXT_TTL = 1800;
var ONE_DAY_TTL = 86400;
var START_LOC = 11;
var END_LOC = 12;


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
						'endLong',
						'departureTime',
						'productId',
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
							return i.hasActiveRequest.then(function (requestActive) {
								if (d.confirmNeed !== true && d.confirmNeed !== 'true' && !requestActive) return true; // no need to cancel, no active trip
								if ((state === 'RIDES_confirm_cancellation' && i.yes_no === 'yes') || d.confirmCancellation === true) return d.confirmCancellation = true;
								if (state === 'RIDES_confirm_cancellation' && d.intent === 'rides_cancel_trip') return d.confirmCancellation = true;
								if ((state === 'RIDES_confirm_cancellation' && i.yes_no === 'no') || d.confirmCancellation === false)  {
									d.confirmCancellation = false;
									d.errConfirmCancellation = 'CANCEL_REQUEST_CANCEL';
									return false;
								}
								return false;
							});
						}
					],
		'confirmNeed' : [
						function(d, b, i) {
							return i.hasActiveRequest;
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
							return i.hasActiveRequest;
						},
						/*function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagSL = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagSL) delete d.cancelFlagSL;
								if (d.errStartLocation === 'CONFIRM_REQUEST_CANCEL') delete d.errStartLocation;
							}
							return false;
						},*/	
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
													if (d.errStartLocation === 'BAD_START_ADDRESS') delete d.errStartLocation;
													return true;
												} else {
													d.errStartLocation = 'BAD_START_ADDRESS';
													return false;
												}
											});
										} else {
											// does not exist in preferences
											logger.debug('Got to setting of errLocation...')
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
		'endLong': [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						/*function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagEL = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagEL) delete d.cancelFlagEL;
								if (d.errEndAddress === 'CONFIRM_REQUEST_CANCEL') delete d.errEndAddress;
							}
							return false;
						},*/
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							if (!d.endLong || d.endLong === 0) return false;
							if (d.errEndLocation === 'NO_END_LOCATION') delete d.errEndLocation;
							return true;
						},
						function(d, b, i) {
							var state = b.context.state;
							if (d.errEndLocation === 'SUSPECT_END_LOCATION') setTerminal(d, b, i);
							if (i.to) {
								// check for location keyword
								var lockeyword;
								if (lockeyword = getLocationKeyword(i.to)) {
									// if keyword, check if preferences set
									d.toLocKeyword = lockeyword;
									return User.getUserPreference(b.user.email, lockeyword + '_address').then (function(doc) {
										logger.debug('Got to then of getUserPreference...')
											
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
											logger.debug('Got to setting of errEndLocation...')
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
						/*function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagDT = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagDT) delete d.cancelFlagDT;
								if (d.errDepartureTime === 'CONFIRM_REQUEST_CANCEL') delete d.errDepartureTime;
							}
							return false;
						},*/
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return true;
						}
					],
		'productId' 	: [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						/*function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagCA = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagCA) delete d.cancelFlagCA;
								if (d.errCarrier === 'CONFIRM_REQUEST_CANCEL') delete d.errCarrier;
							}
							return false;
						},*/
						function(d, b, i) {
							if(d.confirmNeed === false) return true; // exit validations if trip cancelled
							return false;
						},
						function(d, b, i) {
							if(!d.products && d.startLong && d.startLong != 0) {
								logger.debug('Going for products...');
								return getProducts(b.user.name, b.clientHandle, d).then(function(prod) {
									if (prod) {
										var jProducts = JSON.parse(prod);
										if (jProducts.products.length > 0) {
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
							}
							return retVal;
						},
						function(d, b, i) {
							var retVal = false;
							if(i.carrier && i.yes_no === 'no') {
								d.unCarrier = i.carrier;
								if (d.carrier && (d.unCarrier.toLowerCase() === d.carrier.toLowerCase())) delete d.carrier;
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
										logger.debug('OldProductId: %s', oldProductId);
										logger.debug('NewProductId: %s', d.productId);
										logger.debug('Datahash Val: %s', JSON.stringify(d));
										if (jEtas.times.length > 0) {
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
													if (d.productName.toLowerCase() !== d.carrier.toLowerCase()) {
														logger.debug('***************************************** prefVal: GOT HERE 1');
														logger.debug('OldProductId: %s', oldProductId);
														logger.debug('NewProductId: %s', d.productId);
														d.noPreferred = true;
													} else {
														delete d.noPreferred;
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
													if (d.productName.toLowerCase() === d.unCarrier.toLowerCase()) {
														logger.debug('***************************************** prefVal: GOT HERE 2');
														d.onlyUnPreferred = true;
													} else {
														delete d.onlyUnPreferred;
													}
												}
											} else {
												if (i.carrier && i.yes_no !== 'no') {
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
		'confirmRequest' : [
						function(d, b, i) {
							return i.hasActiveRequest;
						},
						/*function(d, b, i) {
							if (i.yes_no === 'no') {
								d.cancelFlagCR = true; // if a 'no', assume cancellation by default. if the 'no' is expected by any subsequent validation, it should clear flag
							} else {
								if (d.cancelFlagCR) delete d.cancelFlagCR;
								if (d.errConfirmRequest === 'CONFIRM_REQUEST_CANCEL') delete d.errConfirmRequest;
							}
							return false;
						},*/
						function(d, b, i) {
							var state = b.context.state;
							if (d.confirmNeed === false) return true; // exit validations if trip cancelled
							if ((state === 'RIDES_confirm_request' && i.yes_no === 'yes') || d.confirmRequest === true || d.confirmRequest === 'true') {
								return d.confirmRequest = true;
							}
							if ((state === 'RIDES_confirm_request' && i.yes_no === 'no') || d.confirmRequest === false || d.confirmRequest === 'false')  {
								d.confirmRequest = false;
								d.errConfirmRequest = "CONFIRM_REQUEST_CANCEL";
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
						if (data.errStartLocation === "CONFIRM_REQUEST_CANCEL") delete errStartLocation;
						if (data.cancelFlagSL === true) {
							data.errStartLocation = "CONFIRM_REQUEST_CANCEL";
							delete data.cancelFlagSL;
						} else if (!data.errStartLocation || errKeys.indexOf(data.errStartLocation) < 0) {
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
						if (data.errEndLocation === "CONFIRM_REQUEST_CANCEL") delete errEndLocation;
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
						return true;
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

						logger.debug('@@@@ CONFIRM REQUEST: 1');
						// get ETA
						if (data.productId) {
							logger.debug('@@@@ CONFIRM REQUEST: 2');
							return getTimeEstimate(user.name, clientHandle, data).then(function (etas) {
								logger.debug('@@@@ CONFIRM REQUEST: 3');
								if (etas) {
									logger.debug('@@@@ CONFIRM REQUEST: 4');
									jEtas = JSON.parse(etas);
									if (jEtas.times && jEtas.times.length > 0) {
										logger.debug('@@@@ CONFIRM REQUEST: 5');
										return getPriceEstimate(user.name, clientHandle, data).then(function (prices) {
											logger.debug('@@@@ CONFIRM REQUEST: 6');
											jPrices = JSON.parse(prices);
											
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
												logger.debug('################ data.noPreferred: %s', data.noPreferred);
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
									var responseText = getResponse(data, 'NO_RIDE_ETA');
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

	this.handleRequest = {
		'rides_cancel_trip' : function(user, clientHandle, data) {
						if (data.confirmCancellation === true) {
							me.cancelRequest(user.name, clientHandle, data);
							getActiveRequest(user.name, clientHandle).then(function(activeRequest) {
								if (activeRequest) {
									var rbody = { header: 'cancel_request', requestId: activeRequest.request_id };
									me.push(user, clientHandle, rbody);
								}
								deleteActiveRequest(user.name, clientHandle);
							});
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
						var userkey = getUserKey(user.name, clientHandle);
						logger.debug('HandleRequest: handling for rides_book_trip... %s', JSON.stringify(data));
						if (data.confirmNeed === false) {
							logger.debug('HandleRequest: handling for rides_book_trip...calling cancelrequest');
							me.cancelRequest(user.name, clientHandle, data);


						} else {
							// check if there's an active request
							checkActiveRequest(user.name, clientHandle).then(function(active) {
								if (active) {
									// ...
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
							});
						}
					},
		'rides_get_info' : function(user, clientHandle, data) {
						me.emit('message', Rides.MODULE, user.name, clientHandle, 'You want to know ' + data.infotype);
					}
	};

}

function checkActiveRequest(username, clientHandle) {
	var userkey = getUserKey(username, clientHandle);
	return cache.hgetall(userkey + ':activerequest').then(function(request) {
		if (!request) {
			return false;
		} else {
			// don't poll for status, webhooks will update
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
		request_id : data.request_id,
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
	var me = this;
	var handlerTodo = '';

	checkActiveRequest(user.name, client.slackHandle).then(function(activeRequest) {
		if (body.outcomes[0].intent === 'rides_cancel_trip' || body.outcomes[0].intent === 'default_cancel_request') {
			handlerTodo = 'rides_cancel_trip';
		} else if (body.context.state === 'RIDES_confirm_cancellation' && body.outcomes[0].intent !== 'rides_request_trip') {
			handlerTodo = 'rides_cancel_trip';
		} else if (activeRequest && body.outcomes[0].intent === 'default_reject') {
			handlerTodo = 'rides_cancel_trip';
		} else if (activeRequest) {
			handlerTodo = 'rides_get_info';
		} else if (body.outcomes[0].intent === 'rides_request_price_estimate' || body.context.state === 'RIDES_request_price_estimate') {
			handlerTodo = 'rides_request_price_estimate';
		} else if (body.outcomes[0].intent === 'rides_request_eta' || body.context.state === 'RIDES_request_eta') {
			handlerTodo = 'rides_request_eta';
		} else if (body.outcomes[0].intent === 'rides_info_query' || body.context.state === 'RIDES_info_query' ) {
			handlerTodo = 'rides_get_info';
		} else {
			handlerTodo = 'rides_book_trip';
		}  
	            
	    me.processData(user, client.slackHandle, body, handlerTodo);
	});
	
	

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
Rides.prototype.processData = function(user, clientHandle, body, handlerTodo) {
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
						    logger.debug('Predicate: ' + remaining.length);
						    return remaining.length < 1 || stop;
						}, function(proceed) {
								if (!proceed) stop = true;
						}, pResponses).done(function(){

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

							} else {
								if (datahash.cancelFlag) me.cancelRequest(user.name, clientHandle, datahash);
							}
						});
					});
				});
			});
		});
		cache.expire(userkey + ':payload', CONTEXT_TTL);
		cache.expire(userkey + ':datacheck', CONTEXT_TTL);
		//cache.expire(userkey + ':activerequest', CONTEXT_TTL);	// for now. change to end based on status	
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
						var handlerTodo = 'rides_book_trip';
						var rbody = { context: { state : Rides.MODULE }};
						getAddressByCoords(body.lat, body.longt).then (function(address) {
							logger.debug('Address: %s', address);
							if (address) rbody.outcomes = [{ 'entities': { 'geofrom': [{"value": address}] }}];
							if (user) me.processData(user, clientHandle, rbody, handlerTodo);
						});
						
					});
				});
				break;
			case 'auth_link':
				utils.shortenLink(body.authLink).then (function(shortAuthLink) {
					me.emit('message', Rides.MODULE, username, clientHandle, 'I need authorization to your ' + body.handler + ' account. Click here to authorize: ' + shortAuthLink);
				});
				break;
			case 'auth_ack':
				me.emit('message', Rides.MODULE, username, clientHandle, 'Thanks @' + username + '. Now hold on a minute...');
				break;
			case 'endpoint_base':
				cache.hset(userkey + ':handler', 'endpoint_base', body.endpoint);
				cache.expire(userkey + ':handler', ONE_DAY_TTL);
				break;
			case 'request_response':
				me.processRequestUpdate(username, clientHandle, body);	
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
			me.emit('message', Rides.MODULE, username, clientHandle, 'Your ride is on its way...');
			if (body.driver) {
				if (body.href) me.emit('message', Rides.MODULE, username, clientHandle, body.href);
				me.emit('message', Rides.MODULE, username, clientHandle, body.driver.name + ' (' + body.driver.rating +' stars) will be there in ' + body.eta + ' minutes in a ' + body.vehicle.make + ' ' + body.vehicle.model + ', registration ' + body.vehicle.license_plate);
				if (body.driver.picture_url != null) me.emit('message', Rides.MODULE, username, clientHandle, body.driver.picture_url);
				me.emit('message', Rides.MODULE, username, clientHandle, 'You can reach him on ' + body.driver.phone_number);
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

Rides.prototype.processRequestError = function(username, clientHandle, body) {
	var me = this;
	switch (body.status) {
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
		case 'other_error':
			me.emit('message', Rides.MODULE, username, clientHandle, "Sorry @" + username + " can't find you a ride at this time. Try again later", " ");
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
		case 'completed':
			me.cancelRequest(username, clientHandle, {});
			deleteActiveRequest(username, clientHandle);
			break;
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
		me.pub.publish(Rides.MODULE.toLowerCase() + '.' + clientHandle, JSON.stringify(data));
	});
}

function setUserGeoData(username, clientHandle, body) {
	var userkey = getUserKey(username, clientHandle);
	cache.hset(userkey + ':payload', 'startLat', body.lat);
	cache.hset(userkey + ':payload', 'startLong', body.longt);
}

function setProductsData(username, clientHandle, body) {
	var userkey = getUserKey(username, clientHandle);
	cache.hset(userkey + ':payload', 'products', JSON.stringify(body.products));
}

function extractEntities(body) {
	var indata = {};
	var entities = {};
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
			if (location.search(keyword) > -1 && location.length < keyword.length + 4) {
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
			}
			if (i.yes_no === 'no') {
				i.to = d.tempLocation;
				d.currLocation = END_LOC;
				delete d.tempLocation;
				terminalSet = true;
				if (d.errStartLocation === 'SUSPECT_START_LOCATION') delete d.errStartLocation;
				if (d.cancelFlagSL) delete d.cancelFlagSL;
				if (d.cancelFlagEL) delete d.cancelFlagEL;
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
			}
			if (i.yes_no === 'no') {
				i.from = d.tempLocation;
				d.currLocation = END_LOC;
				delete d.tempLocation;
				terminalSet = true;
				if (d.errEndLocation === 'SUSPECT_END_LOCATION') delete d.errEndLocation;
				if (d.cancelFlagSL) delete d.cancelFlagSL;
				if (d.cancelFlagEL) delete d.cancelFlagEL;
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
		d.tempLocation = i.location;
	}


}


function getLocationLink(username, clientHandle){
	return utils.getUserLocationLink(username, clientHandle, Rides.MODULE);
	
}

module.exports = Rides;



