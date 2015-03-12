// This is a simple example of how to use the slack-client module. It creates a
// bot that responds to all messages in all channels it is in with a reversed
// string of the text received.
//
// To run, copy your token below, then:
//	npm install
// 	cd examples
// 	node simple.js

var Slack = require('slack-client');
var wit = require('../lib/wit');
var fs = require('fs');
var db = require('../lib/db');
var tokens = require('../tokens.json');
var settings = require('../settings.json');

var witAccessToken = tokens.WIT_ACCESS_TOKEN;
var token = tokens.SLACK_TOKEN, // Add a bot at https://my.slack.com/services/new/bot and copy the token here.
    autoReconnect = true,
    autoMark = true;

var slack = new Slack(token, autoReconnect, autoMark);
var UserContext;

var inContext, outContext;

db.getModel('usercontexts', function(err, model) {
	if (err) {
		// Unable to retrieve usercontext db object
		console.log('Fatal error: ' + e + '. Please resolve and restart the service');

	} else {
		UserContext = model;
		slack.login();
	}
	
});


slack.on('open', function() {

	var channels = [],
	    groups = [],
	    unreads = slack.getUnreadCount(),
	    key;

	for (key in slack.channels) {
		if (slack.channels[key].is_member) {
			channels.push('#' + slack.channels[key].name);
		}
	}

	for (key in slack.groups) {
		if (slack.groups[key].is_open && !slack.groups[key].is_archived) {
			groups.push(slack.groups[key].name);
		}
	}



	console.log('Welcome to Slack. You are @%s of %s', slack.self.name, slack.team.name);
	console.log('You are in: %s', channels.join(', '));
	console.log('As well as: %s', groups.join(', '));
	console.log('You have %s unread ' + (unreads === 1 ? 'message' : 'messages'), unreads);
});

slack.on('message', function(message) {

	var type = message.type,
	    channel = slack.getChannelGroupOrDMByID(message.channel),
	    user = slack.getUserByID(message.user),
	    time = message.ts,
	    text = message.text,
	    response = '';

	try{
		console.log('Received: %s %s @%s %s "%s"', type, (channel.is_channel ? '#' : '') + channel.name, user.name, time, text);
	} catch (e) {

	}


	if (type === 'message' && channel.name === user.name) {

		
		
		// Retrieve user context or create new if not existing
		UserContext.findOne({'username': user.name, 'channel': channel.name }, 'context', function (err, ctxt) {
			if (ctxt){
				inContext = ctxt.context;
				ctxt.remove();
		//		console.log('Context exists: ' + inContext);
			} else {
				// error OR no existing context -> initialize
				inContext = {
    					'state': ''
					};
				console.log('No context: ' + JSON.stringify(inContext));
			}

			// Update context with current user time
			var dateTime = new Date();
			dateTime.setMilliseconds(time);
			inContext.reference_time = dateTime.toISOString();

		//	console.log('Context AFTER much: ' + JSON.stringify(inContext));
	
			// Interprete inbound message -> wit
			var intentBody;
			wit.captureTextIntent(witAccessToken, text, inContext, function(error,feedback) {
				if (error) {
					response = JSON.stringify(feedback);
					console.log('Error1: '+ JSON.stringify(error));
					console.log('Feedback: ' + JSON.stringify(feedback));
					
					// Reply
					channel.send(response);
					console.log('@%s responded with "%s"', slack.self.name, response);
				} else {
					intentBody = feedback;
		//			console.log('Feedback: ' + JSON.stringify(feedback));
				
					// Retrieve processor
					var processorMap = require('../processors/map.json');
					var intent = intentBody.outcomes[0]['intent'];

		//			console.log("Intent: " + intent);

					// Check confidence level
					if (intentBody.outcomes[0]['confidence'] < settings.MIN_CONFIDENCE) 
						intent = 'intent_not_found';

		//			console.log("Updated Intent: " + intent);
		//			console.log("Confidence: " + intentBody.outcomes[0]['confidence']);

					// Create new UserContext and update
					outContext = {
							 state : '' 
						};
						
					outContext.state = intent;
		//			console.log('Context: ' + JSON.stringify(outContext));
					newContext = { username : user.name, channel : channel.name, context: outContext};
		//			console.log('New Model: ' + JSON.stringify(newContext));
					uContext = new UserContext(newContext);

		//			console.log('Saving user context....' + JSON.stringify(uContext));

					uContext.save(function(err) {
						if (err) console.log('Cannot save user context: ' + err);
					});


					if (intent){
						var processorModule = '.' + processorMap.processors[0][intent];
						if (!processorModule) 
							processorModule = '.' + processorMap.processors[0]['intent_not_found'];
					} else {
						var processorModule = '.' + processorMap.processors[0]['intent_not_found'];
					}

					// Run
					try {
						var processor = require(processorModule);
					} catch (e) {
						var processor = require('.' + processorMap.processors[0]['intent_not_found']);
					}

		//			console.log('ProcessorModule: '+ processorModule);

					processor.run(intentBody, user, function(err, resp) {
						if (err) {
							response = resp;
							console.log('Error2: '+ JSON.stringify(err));
							console.log('Feedback: ' + JSON.stringify(resp));
						} else {
							response = resp;
						}
						channel.send(response);
						console.log('@%s responded with "%s"', slack.self.name, response);

					});
				}		
				
				
			});
		});

	}


});

slack.on('error', function(error) {

	console.error('Error: %s', error);
});
