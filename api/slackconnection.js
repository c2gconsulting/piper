// This is a worker class for the Slack client
var EventEmitter = require('events').EventEmitter
var Slack = require('slack-client');
var wit = require('../shared/lib/wit');
var db = require('../shared/lib/db');
var witConfig = require('../shared/config/wit.json');
var logger = require('../shared/lib/log');
var CACHE_PREFIX = 'slackrouter:';
var CONTEXT_TTL = 900;
var cache;


function SlackConnection(client) {
	EventEmitter.call(this);
	cache = require('../shared/lib/cache').getRedisClient();
	this.client = client;
	this.witAccessToken = process.env.WIT_ACCESS_TOKEN || witConfig.WIT_ACCESS_TOKEN; //enable local env variable settings to override global config
	this.inContext = {};
	this.outContext = {};
	this.slack = {};
	
}


SlackConnection.prototype = Object.create(EventEmitter.prototype);
SlackConnection.prototype.constructor = SlackConnection;

SlackConnection.prototype.connect = function(){
	//retrieve Slack token and launch Slack
	this.slack = new Slack(this.client.slackToken, true, true);
	try {
		this.slack.login();
	} catch (e) {
		logger.error('Cannot create connection for ' + this.client.slackHandle + '.slack.com: ' + e);
	}
	
	this.slack.on('open', this.onOpen.bind(this));
	this.slack.on('message', this.onMessage.bind(this));
	this.slack.on('error', this.onError.bind(this));	
}


SlackConnection.prototype.onOpen = function() {
	var channels = [],
	    groups = [],
	    unreads = this.slack.getUnreadCount(),
	    key;

	for (key in this.slack.channels) {
		if (this.slack.channels[key].is_member) {
			channels.push('#' + this.slack.channels[key].name);
		}
	}

	for (key in this.slack.groups) {
		if (this.slack.groups[key].is_open && !this.slack.groups[key].is_archived) {
			groups.push(this.slack.groups[key].name);
		}
	}
	this.emit('open', this.client);

	logger.info('Welcome to Slack. You are @%s of %s', this.slack.self.name, this.slack.team.name);
	logger.info('You are in: %s', channels.join(', '));
	logger.info('As well as: %s', groups.join(', '));
	logger.info('You have %s unread ' + (unreads === 1 ? 'message' : 'messages'), unreads);
	logger.info('SLACK_CONNECTION: Connection Opened');
}


SlackConnection.prototype.onMessage = function(message) {

	var type = message.type,
	    channel = this.slack.getChannelGroupOrDMByID(message.channel),
	    user = this.slack.getUserByID(message.user),
	    time = message.ts,
	    text = message.text,
	    response = '';

	try{
		logger.info('Received: %s %s @%s %s "%s"', type, (channel.is_channel ? '#' : '') + channel.name, user.name, time, text);
		logger.info('SLACK_CONNECTION: Message Received');
	} catch (e) {

	}
	
	if (type === 'message' && channel.name === user.name) {
		var me = this;
		var userkey = CACHE_PREFIX + user.name + '@' + this.client.slackHandle;
		logger.debug('Userkey: ' + userkey);

		// Retrieve user context from cache
		cache.hget(userkey, 'state', function (err, value) {
			if (value){
				me.inContext.state = value;
				cache.hdel(userkey, 'state');
				logger.debug('State for ' + userkey + ': ' + value);
			} else {
				// error OR no existing context -> initialize
				me.inContext = {
    					'state': ''
					};
				logger.info('No context: ' + JSON.stringify(me.inContext));
			}

			// Update context with current user time
			var dateTime = new Date(time*1000);
			me.inContext.reference_time = dateTime.toISOString();
			logger.debug(me.inContext.reference_time);
			
			// Interprete inbound message -> wit
			var intentBody;
			wit.captureTextIntent(me.witAccessToken, text, me.inContext, function(error,feedback) {
				if (error) {
					response = JSON.stringify(feedback);
					logger.debug('Error retrieving intent from wit.ai: '+ JSON.stringify(error));
					logger.debug('Feedback: ' + JSON.stringify(feedback));
					
					// Reply
					channel.send(response);
					logger.info('@%s responded with "%s"', me.slack.self.name, response);
				} else {
					intentBody = feedback;
					logger.debug('Feedback: ' + JSON.stringify(feedback));
				
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
					me.outContext = {
							 state : '' 
						};
						
					// Save to cache
					cache.hset(userkey, 'state', me.getState(intent));
					cache.hgetall(userkey, function(err, obj) {
						logger.debug('New context for ' + userkey + ': ' + JSON.stringify(obj));
					});
					cache.expire(userkey, CONTEXT_TTL);

					if (intent){
						var processorModule = processorMap.processors[0][me.getState(intent)];
						if (!processorModule) {
							processorModule = processorMap.processors[0][me.getState('intent_not_found')];
							logger.debug('Processor not found for ' + me.getState(intent) + ', defaulting to ' + me.getState('intent_not_found'));
						}
					} else {
						var processorModule = processorMap.processors[0][me.getState('intent_not_found')];
						logger.debug('No intent found, defaulting to ' + me.getState('intent_not_found'));
					}

					// Run
					try {
						var processor = require(processorModule);
					} catch (e) {
						var processor = require(processorMap.processors[0][me.getState('intent_not_found')]);
						logger.debug('Error processing intent for state: ' + me.getState(intent) + ' -> ' + e + ', defaulting to ' + me.getState('intent_not_found'));
					}

					//console.log('ProcessorModule: '+ processorModule);

					processor.run(intentBody, user, me.client, function(err, resp) {
						if (err) {
							response = resp;
							logger.debug('Error2: '+ JSON.stringify(err));
							logger.debug('Feedback: ' + JSON.stringify(resp));
						} else {
							response = resp;
						}
						channel.send(response);
						logger.info('@%s responded with "%s"', me.slack.self.name, response);

						// Notify all listeners
						me.emit('message', user, text, me.client);

					});
				}		
				
				
			});
		});

	}

}

SlackConnection.prototype.getState = function(intent) {
	var processorMap = require('./processors/map.json');
	
	if (intent){
		var state = processorMap.states[0][intent];
		if (!state) {
			state = processorMap.states[0]['intent_not_found'];
			logger.debug('State not found for ' + intent + ', defaulting...');
		}
	} else {
		var state = processorMap.states[0]['intent_not_found'];
		logger.debug('No intent found, defaulting to intent_not_found');
	}

	return state;
}


SlackConnection.prototype.onError = function(error) {
	this.emit('error', error, this.client);
	logger.error('Error: %s', error);
	logger.info('SLACK_CONNECTION: Connection Error');
}


SlackConnection.prototype.disconnect = function(){
	this.emit('exit', this.client);
	
	this.slack.autoReconnect = false; // In case connection not active but trying to reconnect
	if (this.slack.disconnect()) {
		return true;
	} else {
		return false;
	}
}

// Export the SlackConnection constructor from this module.
module.exports = SlackConnection;



