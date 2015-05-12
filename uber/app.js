/// <reference path="../typings/node/node.d.ts"/>
var UberUser = require('../shared/models/UberUser');
var mq = require('../shared/lib/mq');
var logger = require('../shared/lib/log');
var defaultConfig = require('../shared/config/default.json');
var uber = require('./lib/uber');
var express = require('express');
var exphbs = require('express-handlebars');
var bodyParser = require('body-parser');
var routes = require('./routes');
var cache = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'uber-handler:';
var RIDES_DESC = 'rides';
var ERROR_RESPONSE_CODE = 422;
var prod = true;
var when = require('when');

// Create the Express application
var app = exports.app = express(); 
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));
app.set('views', 'uber/views/');

// Create `ExpressHandlebars` instance with a default layout.
var hbs = exphbs.create({
    defaultLayout: 'main',
    layoutsDir: 'uber/views/layouts/',
    partialsDir: 'uber/views/',
    compilerOptions: undefined
});

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');

// Disable etag headers on responses
app.disable('etag');

// Set /public as our static content dir
app.use("/", express.static(__dirname + "/public/"));


// Register routes
app.get('/oauth', routes.auth); 
app.post('/hooks', routes.hooks);
app.get('/surge', routes.surge);
app.get('/v1/products', routes.products);
app.get('/v1/estimates/time', routes.timeEstimates);
app.get('/v1/estimates/price', routes.priceEstimates);


var pub = mq.context.socket('PUB', {routing: 'topic'});
var subProcessor = mq.context.socket('SUB', {routing: 'topic'});
var subRoutes = mq.context.socket('SUB', {routing: 'topic'});
var msgid = new Date().getTime();

// subscribe to inbound MQ exchange
logger.info('UBER Handler: Connecting to MQ Exchange <piper.events.out>...');
subProcessor.connect('piper.events.out', RIDES_DESC + '.*', function() {
	logger.info('%s.*: <piper.events.out> connected', RIDES_DESC);
});

subProcessor.on('data', function(data) {
	var jsonData = JSON.parse(data);
	if (data) onProcessorEvent(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
});

subRoutes.connect('piper.events.out', 'uber.routes', function() {
	logger.info('uber.routes: <piper.events.out> connected');
});

subRoutes.on('data', function(data) {
	var jsonData = JSON.parse(data);
	if (data) onRoutesEvent(jsonData);
});


function onProcessorEvent(id, user, client, body) {
	logger.info('Uber Handler.onProcessorEvent for data %s', JSON.stringify(body));
	if (msgid !== id) {
		// update usermail cache
		var emailCacheKey = CACHE_PREFIX + user.email;
		var userclient = {user: user.name, client: client};
		cache.hmset(emailCacheKey, userclient);

		switch (body.header) {
			case 'get_endpoint_base':
				logger.debug('get_endpoint_base...');
				var rbody = { header: 'endpoint_base', endpoint: defaultConfig.protocol + '://uber.' + defaultConfig.domain };
				push(user.email, rbody);		
				break;
			case 'get_products':
				if (body.startLat && body.startLong) {
					uber.getProducts(body.startLat, body.startLong).then(function(products) {
						var rbody = { header: 'products' };
						rbody.products = products;
						push(user.email, rbody);
					});
				} else {
					rbody = { header: 'insufficient_data', endpoint: 'products' };
					push(user.email, rbody);
				}
				break;
			case 'request_ride':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {
						logger.debug('++++++++++++++++++++++++++++++++ TEST LOC 1, %s', JSON.stringify(body));
						checkSurge(user.email, body).then(function(surge) {
							logger.debug('++++++++++++++++++++++++++++++++ TEST LOC 2, %s', surge);
							if (!surge) {
								logger.debug('Requesting ride...');
								uber.rideRequest(access_token, body.productId, body.startLat, body.startLong, body.endLat, body.endLong, prod, body.surge_confirmation_id
									).then(function(response) {
										logger.debug('rideRequest->RESPONSE: %s', JSON.stringify(response));
										var rbody = response;
										rbody.header = 'request_response';
										push(user.email, rbody);
										cache.hset(CACHE_PREFIX + 'requests', response.request_id, user.email); // cache for lookup
									}).catch(function(error) {
										logger.error('Ride Request Error: %s', JSON.stringify(error));
										switch (error.statusCode) {
											case 401:
												cacheRequestData(id, user, client, body); // restart after auth
												cache.hdel(emailCacheKey, 'access_token');
												requestAuth(user.email);
												break;
											case 422:
												var ebody = { header: 'request_error', status: 'create_error' };
												if (error.error.errors) ebody.title = error.error.errors[0].title;
												push(user.email, ebody);
												break;
											case 409:
												if (error.error.errors[0].code === 'surge') {
													cacheRequestData(id, user, client, body); // restart after auth
													requestSurgeConfirmation(user.email, error.error.meta.surge_confirmation.surge_confirmation_id, error.error.meta.surge_confirmation.href);
												} else {
													ebody = { header: 'request_error', status: error.error.errors[0].code };
													if (error.error.errors) ebody.title = error.error.errors[0].title;
													push(user.email, ebody);
												}
												break;
											default:
												ebody = { header: 'request_error', status: 'create_error' };
												if (error.error.errors) ebody.title = error.error.errors[0].title;
												push(user.email, ebody);
										}
									});
								} else {
									// cache request till surge accepted
									cacheRequestData(id, user, client, body);
								}
							}).catch(function(error) {
								logger.debug('checkSurge->ERROR: %s', JSON.stringify(error));
							});
					} else {
						// cache request till authorized
						cacheRequestData(id, user, client, body);
					}
				});

				break;
			case 'get_request_details':
				logger.debug('get_request_details loading...');
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {
						logger.debug('get_request_details->access_token: %s', access_token);
						uber.getRequestDetails(access_token, body.requestId, prod
							).then(function(response) {
								logger.debug('getRequestDetails->RESPONSE: %s', JSON.stringify(response));
								var rbody = response;
								rbody.header = body.tag == undefined ? 'request_details' : body.tag;
								if (response.location && response.location.latitude) {
									cache.hgetall(emailCacheKey).then(function(userData) {
										if (userData && userData.request_data) {
											var reqData = JSON.parse(userData.request_data);
											var clat = reqData.body.startLat, 
												clng = reqData.body.startLong;
											uber.getDriverMap(clat, clng, response.location.latitude, response.location.longitude
												).then(function(link) {
													rbody.href = link;
													push(user.email, rbody);
												});
										} else {
											push (user.email,rbody);
										}
									});									
								} else {
									push (user.email,rbody);
								}
								if (response.status && (response.status === 'no_drivers_available')) {
									cache.hdel(CACHE_PREFIX + 'requests', body.requestId);
								}
							}).catch(function(error) {
								logger.error('Request Details Error: %s', JSON.stringify(error));
								switch (error.statusCode) {
									case 401:
										cacheRequestData(id, user, client, body); // restart after auth
										cache.hdel(emailCacheKey, 'access_token');
										requestAuth(user.email);
									break;
									case 422:
										var ebody = { header: 'request_error', status: 'retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									case 409:
										ebody = { header: 'request_error', status: error.error.errors[0].code };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									default:
										ebody = { header: 'request_error', status: 'retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
								}
							});
					}
				});
				break;
			case 'get_request_details_hook':
				logger.debug('get_request_details hook loading...');
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {
						logger.debug('get_request_details_hook->access_token: %s', access_token);
						uber.getRequestDetails(access_token, body.requestId, prod
							).then(function(response) {
								logger.debug('getRequestDetails_hook->RESPONSE: %s', JSON.stringify(response));
								var rbody = response;
								rbody.header = 'request_details_hook';
								if (response.location && response.location.latitude) {
									cache.hgetall(emailCacheKey).then(function(userData) {
										if (userData && userData.request_data) {
											var reqData = JSON.parse(userData.request_data);
											logger.debug('reqData: %s', JSON.stringify(reqData));
											var clat = reqData.body.startLat, 
												clng = reqData.body.startLong;
											uber.getDriverMap(clat, clng, response.location.latitude, response.location.longitude
												).then(function(link) {
													rbody.href = link;
													push(user.email, rbody);
												});
										} else {
											push (user.email,rbody);
										}
									});									
								} else {
									push (user.email,rbody);
								}
								if (response.status && (response.status === 'no_drivers_available')) {
									cache.hdel(CACHE_PREFIX + 'requests', body.requestId);
								}
							}).catch(function(error) {
								logger.error('Request Details Hook Error: %s', JSON.stringify(error));
								switch (error.statusCode) {
									case 401:
										cacheRequestData(id, user, client, body); // restart after auth
										cache.hdel(emailCacheKey, 'access_token');
										requestAuth(user.email);
										break;
									case 422:
										var ebody = { header: 'request_error', status: 'hook_retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									case 409:
										ebody = { header: 'request_error', status: error.error.errors[0].code };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									default:
										ebody = { header: 'request_error', status: 'hook_retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
								}
							});
					}
				});
				break;
			case 'get_user_activity':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {





					}
				});
				break;
			case 'get_request_map':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {
						uber.getRequestMap(access_token, body.requestId, prod
							).then(function(response) {
								logger.debug('getRequestMap->RESPONSE: %s', JSON.stringify(response));
								var rbody = response;
								rbody.header = 'request_map';
								push(user.email, rbody);
							}).catch(function(error) {
								logger.error('Get Request Map Error: %s', JSON.stringify(error));
								switch (error.statusCode) {
									case 401:
										cacheRequestData(id, user, client, body); // restart after auth
										cache.hdel(emailCacheKey, 'access_token');
										requestAuth(user.email);						
										break;
									case 422:
										var ebody = { header: 'request_error', status: 'retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									case 409:
										ebody = { header: 'request_error', status: error.error.errors[0].code };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									default:
										ebody = { header: 'request_error', status: 'retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
								}
							});
					}
				});
				break;
			case 'get_request_receipt':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {
						cache.hdel(CACHE_PREFIX + 'requests', body.requestId);
						uber.getRequestReceipt(access_token, body.requestId, prod
							).then(function(response) {
								logger.debug('getRequestReceipt->RESPONSE: %s', JSON.stringify(response));
								var rbody = response;
								rbody.header = 'request_receipt';
								push(user.email, rbody);
							}).catch(function(error) {
								logger.error('Get Request Receipt Error: %s', JSON.stringify(error));
								switch (error.statusCode) {
									case 401:
										cacheRequestData(id, user, client, body); // restart after auth
										cache.hdel(emailCacheKey, 'access_token');
										requestAuth(user.email);			
										break;
									case 422:
										var ebody = { header: 'request_error', status: 'retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									case 409:
										ebody = { header: 'request_error', status: error.error.errors[0].code };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									default:
										ebody = { header: 'request_error', status: 'retrieve_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
								}
							});
					}
				});
				break;
			case 'cancel_request':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {
						uber.cancelRequest(access_token, body.requestId, prod
							).then(function(response) {
								var rbody = { header: 'request_cancel', status: 'rider_canceled' };
								push(user.email, rbody);
								cache.hdel(CACHE_PREFIX + 'requests', body.requestId);
							}).catch(function(error) {
								logger.error('Cancel Error: %s', JSON.stringify(error));
								switch (error.statusCode) {
									case 401:
										cacheRequestData(id, user, client, body); // restart after auth
										cache.hdel(emailCacheKey, 'access_token');
										requestAuth(user.email);					
										break;
									case 422:
										var ebody = { header: 'request_error', status: 'delete_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									case 409:
										ebody = { header: 'request_error', status: error.error.errors[0].code };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
										break;
									default:
										ebody = { header: 'request_error', status: 'delete_error' };
										if (error.error.errors) ebody.title = error.error.errors[0].title;
										push(user.email, ebody);
								}
							});
					}
				});
				break;
		}
		msgid = id;
	}
}



function onRoutesEvent(data) {
	if (msgid !== data.id) {
		logger.debug('onRoutesEvent.data: %s', JSON.stringify(data));
		switch (data.header) {
			case 'auth':
				// send user acknowledgement
				var body = { header : 'auth_ack' };
				logger.debug('Calling push(%s,%s)', data.email,JSON.stringify(body));
				push(data.email, body);

				// pick up active request and process
				var emailCacheKey = CACHE_PREFIX + data.email;
				cache.hget(emailCacheKey, 'request_data').then(function(requestData) {
					if (requestData) {
						logger.debug('RequestData: %s', requestData);
						var jsonData = JSON.parse(requestData);
						onProcessorEvent(new Date().getTime(), jsonData.user, jsonData.client, jsonData.body);
					}
				});
				break;
			case 'surge':
				// send user acknowledgement
				body = { header : 'surge_ack' };
				logger.debug('Calling push(%s,%s)', data.email,JSON.stringify(body));
				push(data.email, body);

				// pick up active request and process
				emailCacheKey = CACHE_PREFIX + data.email;
				cache.hget(emailCacheKey, 'request_data').then(function(requestData) {
					if (requestData) {
						logger.debug('RequestData: %s', requestData);
						var jsonData = JSON.parse(requestData);
						jsonData.body.surge_confirmation_id = data.body.surge_confirmation_id;
						onProcessorEvent(new Date().getTime(), jsonData.user, jsonData.client, jsonData.body);
					}
				});
				break;
			case 'webhook':
				// retrieve relevant request
				switch (data.body.event_type) {
					case 'requests.status_changed':
						cache.hget(CACHE_PREFIX + 'requests', data.body.meta.resource_id).then(function (email) {
							if (email) {	
								// pick up active request and process
								var emailCacheKey = CACHE_PREFIX + email;
								cache.hgetall(emailCacheKey).then(function(userData) {
									if (userData) {
										logger.debug('UserData: ' + JSON.stringify(userData));
										var jUser = { name: userData.user, email: email };
										var rbody = { header: 'get_request_details_hook', requestId: data.body.meta.resource_id };
										onProcessorEvent(new Date().getTime(), jUser, userData.client, rbody);
									}
								});
							}
						});
						break;
					case 'requests.receipt.status_changed':
						cache.hget(CACHE_PREFIX + 'requests', data.body.meta.resource_id).then(function (email) {
							if (email) {	
								// pick up active request and process
								var emailCacheKey = CACHE_PREFIX + email;
								cache.hgetall(emailCacheKey).then(function(userData) {
									if (userData) {
										logger.debug('UserData: ' + userData);
										var jUser = { name: userData.user, email: email };
										var rbody = { header: 'get_request_receipt', requestId: data.body.meta.resource_id };
										onProcessorEvent(new Date().getTime(), jUser, userData.client, rbody);
									}
								});
							}
						});
						break;
				}
				// send update to processor
				break;
		}	
		msgid = data.id;
	}
}


function cacheRequestData(id, user, client, body) {
	var requestData = JSON.stringify({
				'id': id,
				'user': user,
				'client': client,
				'body': body
			});
	var emailCacheKey = CACHE_PREFIX + user.email;
	cache.hset(emailCacheKey, 'request_data', requestData);
}

function checkAuth(email) {
	// check cache for access token
	var emailCacheKey = CACHE_PREFIX + email;
	return cache.hget(emailCacheKey, 'access_token').then(function (access_token) {
		if (access_token) {
			logger.debug('checkAuth.access_token: %s', access_token);
			return access_token;
		} else {
			return UberUser.getUserByEmail(email).then(function(doc) {
				if (doc && doc.access_token) {
					// user and access_token exists...check for expiry
					logger.debug('checkAuth.access_token: %s', JSON.stringify(doc));
					if (new Date() < new Date(doc.tokenExpiry)) {
						cache.hset(emailCacheKey, 'access_token', doc.access_token); // update cache
						return doc.access_token; // valid token, return
					} else {
						return refreshAuth(email, doc.refresh_token);
					}
				} else {
					// no_auth
					requestAuth(email);
					return false;
				}
			});
		}
	});
}

function checkSurge(email, body) {
	// check cache for access token
	var emailCacheKey = CACHE_PREFIX + email;
	if (body.surge_confirmation_id) {
		return when(false);
	} else {
		return cache.hget(emailCacheKey, 'access_token').then(function (access_token) {
			return uber.getRequestEstimate(access_token, body.productId, body.startLat, body.startLong, body.endLat, body.endLong, prod
				).then(function(response) {
					logger.debug('requestEstimate->RESPONSE: %s', JSON.stringify(response));
					if (response.price.surge_multiplier > 1) {
						requestSurgeConfirmation(email, response.price.surge_confirmation_id, response.price.surge_confirmation_href);
						return true; // surge active
					} else {
						return false;
					}
				}).catch(function(error){
					logger.error('requestEstimate->ERROR: %s', JSON.stringify(error));
					return false;
				});
		});
	}
}

function requestSurgeConfirmation(email, surge_confirmation_id, surge_confirmation_href) {
	cache.set(CACHE_PREFIX + surge_confirmation_id, email); // cache for lookup					
	var rbody = { header : 'surge_link', surgeLink : surge_confirmation_href };
	push(email, rbody); // push to processor
}


function requestAuth(email) {
	var ref = new Date().getTime(); // generate unique ref and persist along with user details in cache
	var data = { email  : email }; 	// cache ref with user email
	var cachekey = CACHE_PREFIX + ref;
	cache.hmset(cachekey, data);

	var authLink = uber.getAuthorizeLink(ref);

	// push to processor
	var body = { header : 'auth_link', authLink : authLink };
	push(email, body);

}

function refreshAuth(email, refreshToken) {
	var emailCacheKey = CACHE_PREFIX + email;
	return uber.refreshUserToken (refreshToken).then(function(data) {
		if (!data.access_token) {
			return false;
		} else {
			var expiryDate = new Date();
	        expiryDate.setSeconds(expiryDate.getSeconds() + data.expires_in);

	        UberUser.findOneAndUpdate (
	            { email: email }, 
	            { email: email, 
	              access_token: data.access_token,
	              refresh_token: data.refresh_token, 
	              token_scope: data.scope,
	              expiry: expiryDate
	            },
	            {upsert: true}, function (err) {
	            if (err) {
	              logger.error('Unable to update uber user profile: ' + err);
	            } else {
	              logger.info('Uber Profile for User %s successfully updated', email);
	            }
	        });
	        cache.hset(emailCacheKey, 'access_token', data.access_token); // update cache
	        return data.access_token;
		}
	});	

}




/**
 * Push a message to the message exchange for a processor to pick up via the controller
 * @param email - email of user that owns this message
 * @param body - JSON object with message for the processor
 */
function push(email, body) {
	// retrieve user and client by email
	var emailCacheKey = CACHE_PREFIX + email;
	cache.hgetall(emailCacheKey).then(function(data) {
		logger.debug('push.body: %s', JSON.stringify(body));
		if (data.user) {
			body.handler = 'UBER';
			var rdata = { 'id': new Date().getTime(), 'user': data.user, 'client': data.client, module: RIDES_DESC.toUpperCase(), 'body': body };
			logger.info('Uber Handler: Connecting to MQ Exchange <piper.events.in>...');
			logger.debug('push.rdata: %s', JSON.stringify(rdata));
			pub.connect('piper.events.in', function() {
				logger.info('Uber Handler:  MQ Exchange <piper.events.in> connected');
				pub.publish(mq.CONTROLLER_INBOUND, JSON.stringify(rdata));
			});
		}
	});
}



