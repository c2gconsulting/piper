var fs = require('fs');
var db = require('../shared/lib/db');
var mq = require('../shared/lib/mq');
var express = require('express');
var wit = require('../shared/lib/wit');
var SlackConnection = require('./slackconnection');
var logger = require('../shared/lib/log');
var witConfig = require('../shared/config/wit.json');
var cache = require('../shared/lib/cache').getRedisClient();

var CACHE_PREFIX = 'api-server:';
var ERROR_RESPONSE_CODE = 422;
var CONTEXT_TTL = 900;

var w = [];
var processors = [];


var app = exports.app = express(); // Create the Express application
var port = process.env.PORT || 80; // Define environment variables
var router = express.Router(); // Create our Express router
var witAccessToken = process.env.WIT_ACCESS_TOKEN || witConfig.WIT_ACCESS_TOKEN; //enable local env variable settings to override global config

/* 	Retrieve Models:
 * 	- clients
 */

db.getModel('clients', function(err, model) {
	if (err) {
		logger.error('Fatal error: ' + err + '. Please resolve and restart the service'); // Unable to retrieve clients db object
	} else {
		Client = model;
	}	
});


/*
 * Setup subscriber for new trigger MQs (messages not in response to a request)
 * All such messages should be sent by handlers with routing key <mq.CONTROLLER_INBOUND>
 */
var sub = mq.context.socket('SUB', {routing: 'topic'});

logger.info('Piper Controller: Connecting to MQ Exchange <piper.events.in>...');
sub.connect('piper.events.in', mq.CONTROLLER_INBOUND, function() {
	logger.info('Piper Controller: MQ Exchange <piper.events.in> connected');
});

sub.on('data', function(data) {
	jsonData = JSON.parse(data);
	if (data) this.in(jsonData.user, jsonData.client, jsonData.module, jsonData.body);
});


/* 
 *Fire up connections ...
 */
cache.del(CACHE_PREFIX + 'connections'); 
Client.find({'isActive': true }, function (err, clients) {
	if (!err && clients && clients.length > 0){
		for (var i in clients) {
			// Load clients in cache
			cache.hmset('client:' + clients[i]._id, '_id', clients[i]._id, 'slackHandle', clients[i].slackHandle, 'slackToken', clients[i].slackToken, 'adminContact', clients[i].adminContact, 'adminEmail', clients[i].adminEmail, 'isActive', clients[i].isActive);
			cache.hset('clients', clients[i].slackHandle, clients[i]._id);

			// Spawn slack connections
			createSlackConnection(clients[i]);
		}
	} else {
		logger.info('No clients currently registered or active, listening for new clients...');
	}
});

router.get('/register', function(req, res) {	
	var name = req.query.name,
		slackHandle = req.query.handle,
		slackToken = req.query.token,
		adminContact = req.query.contact,
		adminEmail = req.query.email;

	var dataOk = true,
		invalidParam = '';

	if (!name) {
		dataOk = false;
		invalidParam = 'name';
	} else if (!slackHandle) {
		dataOk = false;
		invalidParam = 'slackHandle';
	} else if (!slackToken) {
		dataOk = false;
		invalidParam = 'slackToken';
	} else if (!adminContact) {
		dataOk = false;
		invalidParam = 'adminContact';
	} else if (!adminEmail) {
		dataOk = false;
		invalidParam = 'adminEmail';
	}

	if (dataOk) {
		if (registerClient({
	  		"name": name,
	  		"slackHandle": slackHandle,
	  		"slackToken": slackToken,
	  		"adminContact": adminContact,
	  		"adminEmail": adminEmail,
	  		"isActive": "True"
			})){
			res.end('Client ' + name + ' successfully registered and activated');
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Unable to register client ' + name);
		}
	} else {
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for ' + invalidParam);
	}
});

/* 
 *	Endpoints
 */
router.get('/connect', function(req, res) {
	var slackHandle = req.query.handle;

	cache.hget('clients', slackHandle, function(e, value) {
		if (!e && value) {
			cache.hgetall('client:' + value, function(err, client) {
				if (!err && client){
					if (createSlackConnection(client)) {
						res.json({status: 'Connected', client: client});
					} else {
						res.statusCode = ERROR_RESPONSE_CODE;
						res.end('Cannot create connection');
					}
				} else {
					res.statusCode = ERROR_RESPONSE_CODE;
					res.end('Client ' + slackHandle + ' not registered, please register first');
					logger.info('Client ' + slackHandle + ' not registered, please register first');
				}
			});
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Client ' + slackHandle + ' not registered, please register first');
			logger.info('Client ' + slackHandle + ' not registered, please register first');
		}
	});
});


router.get('/disconnect', function(req, res) {
	var slackHandle = req.query.handle;

	cache.hget('clients', slackHandle, function(e, value) {
		if (!e && value) {
			cache.hgetall('client:' + value, function(err, client) {
				if (!err && client){
					if (removeSlackConnection(client)) {
						res.json({status: 'Disconnected', client: client});
					} else {
						res.statusCode = ERROR_RESPONSE_CODE;
						res.end('Client ' + slackHandle + ' does not have an active connection');
					}
				} else {
					res.statusCode = ERROR_RESPONSE_CODE;
					res.end('Client ' + slackHandle + ' not registered, please register first');
					logger.info('Client ' + slackHandle + ' not registered, please register first');
				}
			});
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Client ' + slackHandle + ' not registered, please register first');
			logger.info('Client ' + slackHandle + ' not registered, please register first');
		}
	});
});


router.get('/getclient', function(req, res) {
	var slackHandle = req.query.handle;

	cache.hget('clients', slackHandle, function(err, value) {
		if (!err && value) {
			cache.hgetall('client:' + value, function(e, client) {
				if (!e && client) {
					res.json(client);
				} else {
					res.statusCode = ERROR_RESPONSE_CODE;
					res.end('Client ' + slackHandle + ' not registered, please register first');
					logger.info('Client ' + slackHandle + ' not registered, please register first');
				}
			});
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Client ' + slackHandle + ' not registered, please register first');
			logger.info('Client ' + slackHandle + ' not registered, please register first');
		}
	});
});

router.get('/getclients', function(req, res) {
	Client.find({}, function (err, clients) {
		if (!err && clients && clients.length > 0){
			res.json(clients);
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('No clients registered');
			logger.info('No clients registered');
		}
	});
});


router.get('/getconnections', function(req, res) {
	cache.zrange(CACHE_PREFIX + 'connections', 0, -1, function(err, connections) {
		if (!err && connections && connections.length > 0){
			res.json(connections);
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('No connections active');
			logger.info('No connections active');
		}
	});

});


router.get('/sethandler', function(req, res) {
	var slackHandle = req.query.client;
	var state = req.query.state;
	var handler = req.query.handler;

	Handler.findOneAndUpdate(
		{slackHandle: slackHandle, state: state}, 
		{slackHandle: slackHandle, state: state, handler: handler, createdAt: new Date() }, 
		{upsert: true}, function (err) {
		if (err) {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('Unable to create handler: ' + err);
			logger.error('Unable to create handler: ' + err);
		} else {
			res.end(handler + ' handler successfully registered for ' + slackHandle + ' and state: ' + state);
		}
	});
});


router.get('/gethandler', function(req, res) {
	var slackHandle = req.query.client;
	var state = req.query.state;
	
	Handler.findOne({slackHandle: slackHandle, state: state }, function (err, h) {
		if (!err && h){
			res.json(h);
		} else {
			res.statusCode = ERROR_RESPONSE_CODE;
			res.end('No handler registered for ' + slackHandle + ' and state: ' + state);
			logger.info('No handler registered for ' + slackHandle + ' and state: ' + state);
		}
	});

});

// Register all our routes with /
app.use('/', router);


var createSlackConnection = function(client) {
	//logger.info('in createSlackConnection: ' + client.slackHandle);
	if (!w[client._id]) {
		try {
			w[client._id] = new SlackConnection(client);
			
			
			// Update registry
			cache.zadd(CACHE_PREFIX + 'connections', new Date().getTime()/1000, client._id, function(err, conn) {
				logger.info('Registered connection for client: ' + client.slackHandle);
			});
			logger.info('Updating registry for client ' + client.slackHandle + '...');

			// Open connection
			w[client._id].connect();

			// Listen for messages from connections
			w[client._id].on('open', function(cl){
				logger.info(cl.name.toUpperCase() + ': Connection established...listening for messages');
			});

			w[client._id].on('dispatch', function(username, message, cl){
				//message dispatched
			});

			w[client._id].on('message', onSlackEvent);

			w[client._id].on('error', function(error, cl){
				logger.info(cl.name.toUpperCase() + ' Error: ' + JSON.stringify(error));
				if (error === 'account_inactive') {
					logger.info('[Client: ' + cl._id + ' - ' + cl.name + '] Removing connection... ')
					removeSlackConnection(cl);
				}
			});

			w[client._id].on('exit', function(cl){
				// remove from registry
				cache.zrem(CACHE_PREFIX + 'connections', cl._id);

		        // remove from array
		        delete w[cl._id];
		        logger.info('[Client: ' + cl._id + ' - ' + cl.name + '] De-registering connection from registry...');
			});

			return true;
		} catch (e) {
			logger.error('Error in create slack connection: ' + e);
			return false;
		}

	} else {
		return false;
	}

}

var onSlackEvent = function(user, client, message) {

	var inContext = {},
		outContext = {};

	var userkey = CACHE_PREFIX + user.name + '@' + client.slackHandle + ':context';
	logger.debug('Userkey: ' + userkey);

	// Retrieve user context from cache
	cache.hget(userkey, 'state').then(function (value) {
		if (value){
			inContext.state = value;
			cache.hdel(userkey, 'state');
			logger.debug('State for ' + userkey + ': ' + value);
		} else {
			// error OR no existing context -> initialize
			inContext = {
					'state': ''
				};
			logger.info('No context: ' + JSON.stringify(inContext));
		}

		// Update context with current user time
		var dateTime = new Date(message.time*1000);
		inContext.reference_time = dateTime.toISOString();
		logger.debug(inContext.reference_time);
		
		// Interprete inbound message -> wit
		var intentBody;
		wit.captureTextIntent(witAccessToken, message.text, inContext, function(error,feedback) {
			if (error) {
				var response = JSON.stringify(feedback);
				logger.error('Error retrieving intent from wit.ai: '+ JSON.stringify(error));
				logger.debug('Feedback: ' + JSON.stringify(feedback));
				
				// Reply
				//channel.send(response);
				//logger.info('@%s responded with "%s"', me.slack.self.name, response);
			} else {
				intentBody = feedback;
				intentBody.context = inContext;
				logger.debug('IntentBody: %s', JSON.stringify(intentBody));

				// Retrieve processor
				var processorMap = require('./processors/map.json');
				var intent = intentBody.outcomes[0]['intent'];

				logger.debug("Intent: " + intent);

				// Check confidence level
				if (intentBody.outcomes[0]['confidence'] < witConfig.MIN_CONFIDENCE) {
					intent = 'intent_not_found';
					logger.info('Low confidence, changing intent to intent_not_found');
				}

				//console.log("Updated Intent: " + intent);
				logger.debug("Confidence: " + intentBody.outcomes[0]['confidence']);

				// Create new UserContext and update
				outContext = {
						 state : '' 
					};
					
				// Save to cache
				cache.hset(userkey, 'state', getModule(intent, inContext.state));
				cache.hgetall(userkey, function(err, obj) {
					logger.debug('New context for ' + userkey + ': ' + JSON.stringify(obj));
				});
				cache.expire(userkey, CONTEXT_TTL);

				if (intent){
					var processorModule = processorMap.processors[0][getModule(intent, inContext.state)];
					if (!processorModule) {
						processorModule = processorMap.processors[0][getModule('intent_not_found')];
						logger.debug('Processor not found for ' + getModule(intent, inContext.state) + ', defaulting to ' + getModule('intent_not_found'));
					}
				} else {
					var processorModule = processorMap.processors[0][getModule('intent_not_found')];
					logger.debug('No intent found, defaulting to ' + getModule('intent_not_found'));
				}

				// Run
				try {
					var Processor = require(processorModule);
					processMessage(user, client, Processor, intentBody);
				} catch (e) {
					logger.debug('Error processing intent for state: ' + getModule(intent, inContext.state) + ' -> ' + e + ', defaulting to ' + getModule('intent_not_found'));
					var Processor = require(processorMap.processors[0][getModule('intent_not_found')]);
					processMessage(user, client, Processor, intentBody);					
				}
			}										
		});
	});
}

var processMessage = function(user, client, Processor, body) {
	if (!processors[Processor.MODULE]) {
		//instantiate and setup processor
		logger.warn('Calling new... ' + Processor.MODULE)
		processors[Processor.MODULE] = new Processor();
		logger.warn('Calling init... ' + Processor.MODULE)
		processors[Processor.MODULE].init();
		logger.warn('Calling onMessage... ' + Processor.MODULE)
		processors[Processor.MODULE].on('message', onProcessorEvent);
		processors[Processor.MODULE].on('error', onProcessorError);	
	} 

	logger.warn('Calling out... ' + Processor.MODULE)
	processors[Processor.MODULE].out(user, client, body);
}

var onHandlerEvent = function(username, clientHandle, module, data) {
	
	if (!processors[module]) {
		//instantiate and setup processor
		var Processor = getProcessor(module);
		if (Processor) {
			processors[Processor.MODULE] = new Processor();
			processors[Processor.MODULE].init();
			processors[Processor.MODULE].on('message', onProcessorEvent);
			processors[Processor.MODULE].on('error', onProcessorError);	

			// send request
			processors[Processor.MODULE].in(username, clientHandle, data);
		}
	} else {
		processors[Processor.MODULE].in(username, clientHandle, data);
	}
}

var onProcessorEvent = function(module, username, clientHandle, message, state) {
	getClientID(clientHandle, function(err, clientID) {
		if (clientID) {
			logger.debug('module: %s, user: %s, client: %s, message: %s', module, username, clientHandle, message);
			if (w[clientID]) {
				w[clientID].sendDM(username, message);
				if (state) setUserState(username, clientHandle, state);
				logger.debug('Message: ' + message + ' sent to user ' + username);
			}
		}
	});
}

var onProcessorError = function(module, username, clientHandle, error, message, state) {
	logger.info('PROCESSOR ERROR - %s: %s', module, error);
	getClientID(clientHandle, function(err, clientID) {
		if (clientID) {
			if (w[clientID]) {
				w[clientID].sendDM(username, message);
				if (state) w[clientID].setUserState(username, state);
				logger.error('There is a problem: ' + error);
			}
		}
	});
}

var getProcessor = function(module) {
	if (module) {
		var processorMap = require('./processors/map.json');
		var processorModule = processorMap.processors[0][module];
		if (processorModule) {
			try {
				return require(processorModule);
			} catch (e) {
				return false;
			}
		}
	}
	return false;
}


var getModule = function(intent, state) {
	var processorMap = require('./processors/map.json');
	
	if (intent){
		var module = processorMap.modules[0][intent];
		if (!module || module === 'DEFAULT') {
			if (state) {
				// retrieve module based on state
				module = state.indexOf('_') > 0 ? state.substring(0, state.indexOf('_')).toUpperCase() : state.toUpperCase();
				if (!processorMap.processors[0][module]) module = processorMap.modules[0]['intent_not_found'];
				logger.debug('Module for intent %s and state %s resolved to %s', intent, state, module);
			}
		}
	} else {
		var module = processorMap.modules[0]['intent_not_found'];
		logger.debug('No intent found, defaulting to intent_not_found');
	}

	return module;
}


var setUserState = function(username, clientHandle, state) {
	var userkey = CACHE_PREFIX + username + '@' + clientHandle + ':context';
	cache.hset(userkey, 'state', state);
}



var getClientID = function(clientHandle, callback) {
	cache.hget('clients', clientHandle, callback);
}

var removeSlackConnection = function(client) {
	if (w[client._id]) {
		w[client._id].disconnect();
		return true;
	} else {
		return false;
	}
}		

var registerClient = function(client) {
	try {
		// Check if client already registered
		Client.findOne({ slackHandle:client.slackHandle }, function (err, newClient) {
			if (!err && newClient) {
				// client already exists - exit
				logger.info('Client ' + client.slackHandle + ' already registered');
			} else {
				var c = new Client(client);
				c.save(function(err) {
					if (err) {
						logger.error('Cannot register new client: ' + err);
					} else {
						logger.info('Client successfully registered, firing up slack worker...');
						Client.findOne({ slackHandle:client.slackHandle }, function (err, nc) {
							if (!err && nc) {
								// Newly created client - load in cache
								cache.hmset('client:' + nc._id, '_id', nc._id, 'slackHandle', nc.slackHandle, 'slackToken', nc.slackToken, 'adminContact', nc.adminContact, 'adminEmail', nc.adminEmail, 'isActive', nc.isActive);
								cache.hset('clients', nc.slackHandle, nc._id);

								createSlackConnection(nc);
							} else {
								logger.error('Error, unable to load client: ' + err);
							}
						});

					}
				});
			}
		});
		return true;
	} catch (e) {
		logger.error('Unable to register new client: ' + e);
		return false;
	}

}



