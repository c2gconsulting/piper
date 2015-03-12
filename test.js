// Get the packages we need
var express = require('express');
var wit = require('./lib/wit');
var fs = require('fs');
var tokens = require('./tokens.json');
var Log = require('log');

// Create our Express application
var app = express();

// Define environment variables
var port = process.env.PORT || 3000;

var witAccessToken = tokens.WIT_ACCESS_TOKEN;

// Create our Express router
var router = express.Router();

// Initialize logger
var logger = new Log(process.env.PIPER_LOG_LEVEL || 'info');

var context = {
    "state": ""
};

// Requests to <server:port>/api
router.get('/', function(req, res) {
	if (!req.query.text) {
		res.end("No text to process");
	} else {
		// Interprete inbound message -> wit
		var intentBody;
		var response = '';
		wit.captureTextIntent(witAccessToken, req.query.text, context, function(error,feedback) {
			if (error) {
				response = JSON.stringify(feedback);
				console.log('Error1: '+ JSON.stringify(error));
				console.log('Feedback: ' + JSON.stringify(feedback));
				
				res.json(feedback);
			} else {
				res.json(feedback);


				intentBody = feedback;
				console.log('Feedback: ' + JSON.stringify(feedback));
			
				// Retrieve processor
				var processorMap = require('./processors/map.json');
				var intent = intentBody.outcomes[0]['intent'];

				console.log("Intent: " + intent);

				if (intent){
					var processorModule = processorMap.processors[0][getState(intent)];
					if (!processorModule) {
						processorModule = processorMap.processors[0]['NO_INTENT'];
						logger.debug('Processor not found for ' + getState(intent) + ', defaulting to NO_INTENT');
					}
				} else {
					var processorModule = processorMap.processors[0]['NO_INTENT'];
					logger.debug('No intent found, defaulting to NO_INTENT');
				}

				// Run
				try {
					var processor = require(processorModule);
				} catch (e) {
					var processor = require(processorMap.processors[0]['NO_INTENT']);
					logger.debug('Error processing intent for state: ' + getState(intent) + ' -> ' + e + ', defaulting to NO INTENT');
				}

				console.log('ProcessorModule: '+ processorModule);
				var user = {
					"name": "Spinner"
				};

				processor.run(intentBody, user, 'test', function(err, resp) {
					if (err) {
						response = resp;
						console.log('Error2: '+ JSON.stringify(error));
						console.log('Feedback: ' + JSON.stringify(resp));
					} else {
						response = resp;
					}
					console.log('Slack respond with "%s"', response);

				});
			}		
			
			
		});
	}


});

var getState = function(intent) {
	var processorMap = require('./processors/map.json');
	
	if (intent){
		var state = processorMap.states[0][intent];
		if (!state) {
			state = processorMap.states[0]['intent_not_found'];
			logger.debug('State not found for ' + intent + ', defaulting to NO_INTENT');
		}
	} else {
		var state = processorMap.states[0]['intent_not_found'];
		logger.debug('No intent found, defaulting to intent_not_found');
	}

	return state;
}

// Register all our routes with /api
app.use('/api', router);

// Start the server
app.listen(port);
