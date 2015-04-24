var UberUser = require('../shared/models/UberUser');
var mq = require('../shared/lib/mq');
var logger = require('../shared/lib/log');
var uber = require('./lib/uber');
var express = require('express');
var exphbs = require('express-handlebars');
var bodyParser = require('body-parser');
var routes = require('./routes');
var cache = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'uber-handler:';
var RIDES_DESC = 'rides';
var ERROR_RESPONSE_CODE = 422;

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
app.get('/hooks', routes.hooks);
app.get('/surge', routes.surge);


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
	jsonData = JSON.parse(data);
	logger.info('Uber HANDLER: Received data -> %s', data);
	if (data) onProcessorEvent(jsonData.id, jsonData.user, jsonData.client, jsonData.body);
});

subRoutes.connect('piper.events.out', 'uber.routes', function() {
	logger.info('uber.routes: <piper.events.out> connected');
});

subRoutes.on('data', function(data) {
	jsonData = JSON.parse(data);
	if (data) onRoutesEvent(data);
});


function onProcessorEvent(id, user, client, body) {
	logger.info('Uber Handler.onProcessorEvent for data %s', JSON.stringify(body));
	if (msgid !== id) {
		// update usermail cache
		var emailCacheKey = CACHE_PREFIX + user.email;
		var userclient = {user: user.name, client: client};
		cache.hmset(emailCacheKey, userclient);

		switch (body.header) {
			case 'request_ride':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {





					}
				});

			break;
			case 'get_time_estimate':


			break;
			case 'get_price_estimate':

			break;
			case 'get_request_details':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {





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





					}
				});
			break;
			case 'get_request_receipt':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {





					}
				});
			break;
			case 'cancel_request':
				checkAuth(user.email).then(function(access_token) {
					if (access_token) {





					}
				});
			break;
		}
		msgid = id;
	}
}

function onRoutesEvent(data) {
	if (msgid !== id) {
		switch (data.header) {
			case 'auth':
				// pick up active request and process

			break;
			case 'webhook':
				// retrieve relevant request
				// send update to processor
			break;
		}	
		msgid = id;
	}
}

function checkAuth(email) {
	// check cache for access token
	var emailCacheKey = CACHE_PREFIX + email;
	return cache.hget(emailCacheKey, 'access_token').then(function (access_token) {
		if (access_token) {
			return access_token;
		} else {
			return UberUser.getUserByEmail(email).then(function(doc) {
				if (doc && doc.access_token) {
					// user and access_token exists...check for expiry
					if (typeof doc.tokenExpiry == Date && new Date() < doc.tokenExpiry) {
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
		
		if (data.user) {
			body.handler = 'UBER';
			var rdata = { 'id': new Date().getTime(), 'user': data.user, 'client': data.client, module: RIDES_DESC.toUpperCase(), 'body': body };
			logger.info('Uber Handler: Connecting to MQ Exchange <piper.events.in>...');
			pub.connect('piper.events.in', function() {
				logger.info('Uber Handler:  MQ Exchange <piper.events.in> connected');
				pub.publish(mq.CONTROLLER_INBOUND, JSON.stringify(rdata));
			});
		}
	});
}



