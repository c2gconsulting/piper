var EventEmitter = require('events').EventEmitter;
var Slack = require('slack-client');
var wit = require('../shared/lib/wit');
var db = require('../shared/lib/db');
var logger = require('../shared/lib/log');
var CACHE_PREFIX = 'slackrouter:';
var util = require('util');
var CONTEXT_TTL = 900;
var cache;


function SlackConnection(client) {
	EventEmitter.call(this);
	cache = require('../shared/lib/cache').getRedisClient();
	this.client = client;
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
};


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
	//logger.info('You are in: %s', channels.join(', '));
	//logger.info('As well as: %s', groups.join(', '));
	//logger.info('You have %s unread ' + (unreads === 1 ? 'message' : 'messages'), unreads);
	logger.info('SLACK_CONNECTION: Connection Opened');
};


SlackConnection.prototype.onMessage = function(message) {

	var type = message.type,
	    channel = this.slack.getChannelGroupOrDMByID(message.channel),
	    user = this.slack.getUserByID(message.user),
	    time = message.ts,
	    text = message.text,
	    response = '';

	var ignoreFlag = false;

	if (message.subtype)
		ignoreFlag = true;
	
	if (message.subtype === "message_changed") {
		if (ignoreFlag) logger.debug('IGNORE FLAG SET');
		user = this.slack.getUserByID(message.message.user);
		text = message.message.text;
		logger.info('SlackConnection.onMessage: Original message changed by %s', user.name);
		logger.debug('Message: %s', JSON.stringify(message));
		logger.debug('Message.Message: %s', JSON.stringify(message.message));	
		// if (user.name === channel.name) channel.send('Hey @' + user.name + ' quit changing your messages you already sent, its very confusing');
	}

	//logger.debug('USER DETAILS: %s', util.inspect(user));
	//logger.debug('MESSAGE DETAILS: %s', util.inspect(message));
	
	try{
		logger.info('Received: %s %s @%s %s "%s"', type, (channel.is_channel ? '#' : '') + channel.name, user.name, time, text);
	} catch (e) {

	}
	
	if (message.subtype) logger.debug('Message.Subtype: %s', JSON.stringify(message.subtype));

	if (!message.subtype && type === 'message' && (channel.name === user.name || text.search(this.slack.self.id) > 0) && user.id !== this.slack.self.id) {
		if (ignoreFlag) logger.debug('IGNORE FLAG SET');
		logger.debug('IGNORE FLAG: ' + ignoreFlag);
		
		logger.info('SLACK_CONNECTION: Message Received');

		var piperUser = { 'slackId' : user.id,
						  'name' : user.name,
						  'email' : user.profile.email,
						  'first_name' : user.profile.first_name,
						  'last_name' : user.profile.last_name,
						  'full_name' : user.profile.real_name,
						  'timezone' : user.tz,
						  'timezone_offset' : user.tz_offset,
						  'phone' : user.profile.phone,
						  'is_admin' : user.is_admin,
						  'avatar' : user.profile.image_48 };

		var chatMessage = { 'text' : text,
							'time' : time,
							'type' : 'textMessage' };

		this.emit('message', piperUser, this.client, chatMessage);
	}
};



SlackConnection.prototype.sendDM = function(username, message) {
	try {
		this.slack.getDMByName(username).send(message);
		logger.info('@%s responded with "%s"', this.slack.self.name, message);
		this.emit('dispatch', username, message, this.client);
	} catch (e) {
		logger.error('Unable to dispatch message to user %s, error: %s', username, e);
	}
};


SlackConnection.prototype.sendRichDM = function(username, message, attachments) {
	try {
		var userId = this.slack.getUserByName(username).id;
		var params = { channel: userId, text: message, unfurl_links: true };
		if (attachments) params.attachments = attachments;
		logger.debug('Params: %s', JSON.stringify(params));
		
		this.slack._apiCall('chat.postMessage', params, function(response) {
			logger.info('Rich Message sent...response: %s', JSON.stringify(response));
			this.emit('dispatch', username, message, this.client);
		});
		
	} catch (e) {
		logger.error('Unable to dispatch message to user %s, error: %s', username, e);
	}
};



SlackConnection.prototype.onError = function(error) {
	this.emit('error', error, this.client);
	logger.error('Error: ' + JSON.stringify(error));
	logger.info('SLACK_CONNECTION: Connection Error');
};


SlackConnection.prototype.disconnect = function(){
	this.emit('exit', this.client);
	
	this.slack.autoReconnect = false; // In case connection not active but trying to reconnect
	if (this.slack.disconnect()) {
		return true;
	} else {
		return false;
	}
};

// Export the SlackConnection constructor from this module.
module.exports = SlackConnection;



