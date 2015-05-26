var fs = require('fs'),
	db = require('../shared/lib/db'),
	mq = require('../shared/lib/mq');

var express = require('express'),
	exphbs = require('express-handlebars'),
	http = require('http'),
	routes = require('./routes');

var wit = require('../shared/lib/wit');
var slackAPI = require('./lib/slack');
var SlackConnection = require('./slackconnection');
var User = require('../shared/models/User');
var Client = require('../shared/models/Client');
var logger = require('../shared/lib/log');
var witConfig = require('../shared/config/wit.json');
var cache = require('../shared/lib/cache').getRedisClient();

var CACHE_PREFIX = 'api-server:';
var ERROR_RESPONSE_CODE = 422;
var AUTH_ERROR_RESPONSE_CODE = 409;
var CONTEXT_TTL = 36000;

var w = [];
var processors = [];
  
// Create an express instance and set a port variable
var app = exports.app = express();
var router = express.Router(); // Create our Express router
app.set('views', 'home/views/');

// Create `ExpressHandlebars` instance with a default layout.
var hbs = exphbs.create({
    defaultLayout: 'main',
    layoutsDir: 'home/views/layouts/',
    partialsDir: 'home/views/partials/',
    compilerOptions: undefined
});

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('handlebars', hbs.engine);
app.set('view engine', 'handlebars');


// Disable etag headers on responses
app.disable('etag');

// WEB Routes
app.get('/geo', routes.geo);
app.get('/', routes.index);
app.use("/", express.static(__dirname + "/public/"));

app.use('/api', router); //api router

var witAccessToken = process.env.WIT_ACCESS_TOKEN || witConfig.WIT_ACCESS_TOKEN; //enable local env variable settings to override global config


/*
 * Setup subscriber for new trigger MQs (messages not in response to a request)
 * All such messages should be sent by handlers with routing key <mq.CONTROLLER_INBOUND>
 */
var sub = mq.context.socket('SUB', {routing: 'topic'});
var schedSub = mq.context.socket('SUB', {routing: 'topic'});

logger.info('Piper Controller: Connecting to MQ Exchange <piper.events.in>...');
sub.connect('piper.events.in', mq.CONTROLLER_INBOUND, function() {
	logger.info('Piper Controller: MQ Exchange <piper.events.in> connected');
});

sub.on('data', function(data) {
	var jsonData = JSON.parse(data);
	if (data) onHandlerEvent(jsonData.id, jsonData.user, jsonData.client, jsonData.module, jsonData.body);
});


logger.info('Piper Controller: Connecting to MQ Exchange <piper.events.scheduler>...');
schedSub.connect('piper.events.scheduler', mq.CONTROLLER_INBOUND, function() {
	logger.info('Piper Controller: MQ Exchange <piper.events.scheduler> connected');
});

schedSub.on('data', function(data) {
	var jsonData = JSON.parse(data);
	if (data) onHandlerEvent(jsonData.id, jsonData.user, jsonData.client, jsonData.module, jsonData.body);
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

//Schedule daily connection refresh



/* 
 *	API Endpoints
 */
 router.get('/register', function(req, res) {	
	var token = req.query.token;
	
	if (token) {
		slackAPI.postRequest('rtm.start', { token: token }).then(function(response) {
			logger.info('New Client RTM.API...response status: %s', JSON.stringify(response.ok)); 
			var adminContact, adminEmail;
			if (response && response.ok === true) {
				response.users.every(function(user) {
					if (user.is_primary_owner) {
						adminContact = user.real_name;
						adminEmail = user.profile.email;
						return false;
					} 
					return true;
				});
				registerClient({
				  		"name": response.team.name,
				  		"slackHandle": response.team.domain,
				  		"slackToken": token,
						"botAlias": response.self.name,
				  		"adminContact": adminContact,
				  		"adminEmail": adminEmail,
				  		"isActive": true}, function (err, c){
						if (!err) {	  
							var resp = { 'ok': true,
							 'domain': response.team.domain,
							 'email' : adminEmail,
							 'name'	 : response.team.name,
							 'bot'   : response.self.name
							};			
							res.statusCode = 200; // All good
							res.json(resp); 
						} else {
							res.statusCode = ERROR_RESPONSE_CODE;
							var r = { 'ok': false, 'error': err };
							if (err === 'existing_client') {
								r.domain = response.team.domain;
								r.email = adminEmail;
								r.name = response.team.name;
								r.bot = c.botAlias || response.self.name;
							}
							res.json(r);
						} 
				});
			} else {
				res.statusCode = AUTH_ERROR_RESPONSE_CODE;
				if (!response) response = { 'ok': false };
				res.json(response);
			}	
		});
	} else {
		res.statusCode = ERROR_RESPONSE_CODE;
		var resp = { 'ok': false, 'error': 'invalid_token' };
		res.json(resp);
	}	
});

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

router.get('/refreshconnections', function(req, res) {
	var count = refreshConnections();
	res.end('Refreshed ' + count + ' connections');
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

};

var refreshConnections = function() {
	var count = 0;
	for (var i=0; i<w.length; i++) {
		if (w[i].reconnect()) count++;
	}
	return count;
};


var onSlackEvent = function(user, client, message) {

	var inContext = {},
		outContext = {};

	var userkey = CACHE_PREFIX + user.name + '@' + client.slackHandle + ':context';
	var sukey = CACHE_PREFIX + 'slackusers';
	logger.debug('Userkey: ' + userkey);
	

	// Check if user registered and register
	cache.sismember(sukey, user.slackId)
		.then( function(value) {
			if (value === 1) {
				// user record exists...do nothing
			} else {
				// user record does not exist -> check if user exists by email
				User.getUserByEmail(user.email)
					.then(function(doc) {
						if (doc) {
							// user exists
							User.findOneAndUpdate (
								{ email: user.email }, 
								{ slackProfiles   : [{
								      id            : user.slackId
								    , name          : user.name
								    , clientHandle  : client.slackHandle
								    , is_admin      : user.is_admin
								  }]
								},
								{upsert: true}, function (err) {
								if (err) {
									logger.error('Unable to update user slack profile: ' + err);
								} else {
									logger.info('Slack Profile for User %s successfully created', user.email);
									cache.sadd(sukey, user.slackId);
								}
							});
						} else {
							newUser = new User({
								first_name      : user.first_name
							  , last_name       : user.last_name
							  , full_name       : user.full_name
							  , email           : user.email
							  , phone           : user.phone
							  , avatar          : user.avatar
							  , timezone		: user.timezone
							  , timezone_offset	: user.timezone_offset 
							  , active          : true
							  , createdAt       : new Date()
							  , slackProfiles   : [{
							      id            : user.slackId
							    , name          : user.name
							    , clientHandle  : client.slackHandle
							    , is_admin      : user.is_admin
							  }]
							});
							newUser.save( function (err) {
								if (err) {
									logger.error ('Cannot register new user %s: %s', user.email, err);
								} else {
									logger.info('User %s successfully created', user.email);
									cache.sadd(sukey, user.slackId);
								}
							});	
						}

					});
			}
			
			// update user timezone
			User.findOneAndUpdate (
				{ email: user.email }, 
				{ timezone: user.timezone,
				  timezone_offset: user.timezone_offset
				},
				{upsert: true}, function (err) {
				if (err) {
					logger.error('Unable to update user slack profile: ' + err);
				} else {
					logger.info('Slack Profile for User %s successfully updated', user.email);
					cache.sadd(sukey, user.slackId);
				}
			});

		});
	
	// save user details to cache
	cache.hmset(user.name + '@' + client.slackHandle, user);

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

		// Update context with current user timezone
		//var dateTime = new Date(message.time * 1000);
		//inContext.reference_time = dateTime.toISOString();
		//logger.debug(inContext.reference_time);
		//logger.debug(JSON.stringify(user));
		inContext.timezone = user.timezone;
		
		// Interprete inbound message -> wit
		var intentBody;
		var processorMap = require('./processors/map.json');
				

		wit.captureTextIntent(witAccessToken, message.text, inContext, function(error,feedback) {
			if (error) {
				//var response = JSON.stringify(feedback);
				logger.error('ALARM! -> Error retrieving intent from wit.ai: '+ JSON.stringify(error));
				logger.debug('Feedback: ' + JSON.stringify(feedback));
				
				cache.hset(userkey, 'state', inContext.state); // retain context in cache
				cache.expire(userkey, CONTEXT_TTL);
				
				var Processor = require(processorMap.processors[0][getModule('intent_not_found')]);
				processMessage(user, client, Processor, { _text: message.text });
				logger.debug('WIT error, defaulting to ' + getModule('intent_not_found'));
				
				
				// Reply
				//channel.send(response);
				//logger.info('@%s responded with "%s"', me.slack.self.name, response);
			} else {
				intentBody = feedback;
				intentBody.context = inContext;
				logger.debug('IntentBody: %s', JSON.stringify(intentBody));

				// Retrieve processor
				var intent = intentBody.outcomes[0]['intent'];

				logger.debug("Intent: " + intent);

				// Check confidence level

				var retainState = false;
				if (intentBody.outcomes[0]['confidence'] < witConfig.MIN_CONFIDENCE) {
					intent = 'unknown_intent';
					intentBody.outcomes[0].intent = 'unknown_intent';
					retainState = true; // don't change state if intent changed
					logger.info('Low confidence, changing intent to intent_not_found');
				}
				
				logger.debug("Confidence: " + intentBody.outcomes[0]['confidence']);
				if (intent === 'chitchat') retainState = true; // also retain state if chitchat to allow better recovery
				
				// Create new UserContext and update
				outContext = {
						 state : '' 
					};
					
				// Save to cache
				if (!retainState) {
					cache.hset(userkey, 'state', getModule(intent, inContext.state)); // update state to reflect new module
				} else {
					cache.hset(userkey, 'state', inContext.state); // retain original state -> allows user to proceed with conversation with the old state
				}
				
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
					processorModule = processorMap.processors[0][getModule('intent_not_found')];
					logger.debug('No intent found, defaulting to ' + getModule('intent_not_found'));
				}

				// Run
				try {
					var Processor = require(processorModule);
					processMessage(user, client, Processor, intentBody);
				} catch (e) {
					logger.debug('Error processing intent for state: ' + getModule(intent, inContext.state) + ' -> ' + e + ', defaulting to ' + getModule('intent_not_found'));
					Processor = require(processorMap.processors[0][getModule('intent_not_found')]);
					processMessage(user, client, Processor, intentBody);					
				}
			}										
		});
	});
};

var processMessage = function(user, client, Processor, body) {
	if (!processors[Processor.MODULE]) {
		//instantiate and setup processor
		processors[Processor.MODULE] = new Processor();
		processors[Processor.MODULE].init();
		processors[Processor.MODULE].on('message', onProcessorMessage);
		processors[Processor.MODULE].on('rich_message', onProcessorRichMessage);
		processors[Processor.MODULE].on('error', onProcessorError);	
	} 

	processors[Processor.MODULE].out(user, client, body);
};

var onHandlerEvent = function(msgid, username, clientHandle, module, data) {
	logger.debug('onHandlerEvent-> msgid: %s, username: %s, clientHandle: %s, module: %s, data: %s', msgid, username, clientHandle, module, JSON.stringify(data));
	if (!processors[module]) {
		//instantiate and setup processor
		var Processor = getProcessor(module);
		if (Processor) {
			processors[Processor.MODULE] = new Processor();
			processors[Processor.MODULE].init();
			processors[Processor.MODULE].on('message', onProcessorMessage);
			processors[Processor.MODULE].on('rich_message', onProcessorRichMessage);
			processors[Processor.MODULE].on('error', onProcessorError);	

			// send request
			processors[Processor.MODULE].in(msgid, username, clientHandle, data);
		}
	} else {
		processors[module].in(msgid, username, clientHandle, data);
	}
};


var onProcessorMessage = function(module, username, clientHandle, message, state) {
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
};


var onProcessorRichMessage = function(module, username, clientHandle, message, attachments, state) {
	getClientID(clientHandle, function(err, clientID) {
		if (clientID) {
			logger.debug('module: %s, user: %s, client: %s, message: %s, attachments: %s', module, username, clientHandle, message, JSON.stringify(attachments));
			if (w[clientID]) {
				w[clientID].sendRichDM(username, message, attachments);
				if (state) setUserState(username, clientHandle, state);
				logger.debug('Rich Message: ' + message + ' sent to user ' + username);
			}
		}
	});
};


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
};

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
};


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
			} else {
				module = processorMap.modules[0]['intent_not_found'];
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

var registerClient = function(client, cb) {
	try {
		// Check if client already registered
		Client.findOne({ slackHandle:client.slackHandle }, function (err, newClient) {
			if (!err && newClient) {
				// client already exists - exit
				logger.info('Client ' + client.slackHandle + ' already registered');
				cb('existing_client', newClient);
			} else {
				var c = new Client(client);
				c.save(function(err) {
					if (err) {
						logger.error('Cannot register new client: ' + err);
						cb('registration_failure');
					} else {
						logger.info('Client successfully registered, firing up slack worker...');
						Client.findOne({ slackHandle:client.slackHandle }, function (err, nc) {
							if (!err && nc) {
								// Newly created client - load in cache
								cache.hmset('client:' + nc._id, nc);
								cache.hset('clients', nc.slackHandle, nc._id);
								createSlackConnection(nc);
								cb();
							} else {
								logger.error('Error, unable to load client: ' + err);
								cb('registration_failure');
							}
						});

					}
				});
			}
		});
		return true;
	} catch (e) {
		logger.error('Unable to register new client: ' + e);
		cb('registration_failure');
		return false;
	}

}



