var fs = require('fs');
var db = require('../shared/lib/db');
var express = require('express');
var Log = require('log');
var ERROR_RESPONSE_CODE = 422;
var cache = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'piper-generic-handler:';
var request = require('request');
var http = require('http');
var responseHTML = "<!DOCTYPE html> \
	<html> \
	<head> \
		<style type=\"text/css\"> \
			@css \
		</style> \
		<script type=\"text/javascript\"> \
		</script> \
		<title>Piper for Instagram</title> \
	</head> \
	<body> \
		<div class=\"container\"> \
    <header> \
    	<h1>Piper for Instagram</h1> \
  	</header> \
  	<ul><li> \
  	<span class=\"text\" style=\"color:@color\">@message</span> \
  	</ul></li> \
	</body> \
	</html>";

fs.readFile('./generic/html/oauth.css', 'utf8', function (err,data) {
	if (err) {
		responseHTML = responseHTML.replace("@css", '');
	}else{
		responseHTML = responseHTML.replace("@css", data);
	}
});



// Create the Express application
var app = exports.app = express(); 

// Define environment variables
var port = process.env.PORT || 80;

// Create our Express router
var router = express.Router();

// Initialize logger
var logger = new Log(process.env.PIPER_LOG_LEVEL || 'info');


/* 	Retrieve Models:
 * 	- HandlerEndPoints
 */

db.getModel('handlerendpoints', function(err, model) {
    if (err) {
      // Unable to retrieve HandlerEndPoints db object
      logger.error('Fatal error: ' + err + '. Please resolve and restart the service');
    } else {
      HandlerEndPoints = model;
    } 
 });

//cache.del(CACHE_PREFIX + 'HandlerEndPoints');

// Load up API Hosts to cache
HandlerEndPoints.find({'isActive': true }, function (err, handlerEndPoints) {
	if (!err && handlerEndPoints && handlerEndPoints.length > 0){
		for (var i in handlerEndPoints) {
			// Load clients in cache
			cache.hmset(CACHE_PREFIX + 'client:' + handlerEndPoints[i].clientID, 'name', handlerEndPoints[i].name, 'hostURI', handlerEndPoints[i].hostURI, 'serverToken', handlerEndPoints[i].serverToken, 'params', handlerEndPoints[i].params); // is active not loaded because the assumption is that only active HandlerEndPoints are loaded to cache
			//cache.hset(CACHE_PREFIX + 'clients:', handlerEndPoints[i].name, handlerEndPoints[i]._id);

			// Do other initialization commands here
		}
	} else {
		logger.info('No API Hosts registered for this handler... Handler will therefore be disabled');
	}
});


router.get('/register', function(req, res) {

	//http://generic.piperlabs.io/register?clientID=c2g&name=c2g%20consulting&hostURI=https://api.instagram.com&params=%7B%22instagram_client_id%22%3A%2203c54c6e8db94a34a3ab146cf997504a%22%2C%22instagram_client_secret%22%3A%22fc971c5759ad4e54b800da47a3914405%22%2C%22instagram_redirect_uri%22%3A%22http%3A%2F%2Fgeneric.piperlabs.io%2Fgetoauth%2F%3FclientID%3D%40cid%26userID%3D%40uid%22%7D%20%09
    //{"instagram_client_id":"03c54c6e8db94a34a3ab146cf997504a","instagram_client_secret":"fc971c5759ad4e54b800da47a3914405","instagram_redirect_uri":"http://piperlabs.io:3001/getoauth/?clientID=@cid&userID=@uid"}
	
	var clientID = req.query.clientID,
		name = req.query.name,
		hostURI = req.query.hostURI,
		serverToken = req.query.serverToken;
		params = req.query.params;

	var dataOk = true,
		invalidParam = '';

	if (!clientID) {
		dataOk = false;
		invalidParam = 'clientID';
	} else if (!name) {
		dataOk = false;
		invalidParam = 'name';
	} else if (!hostURI) {
		dataOk = false;
		invalidParam = 'hostURI';
	} 

	if (!serverToken) { // Server token is not mandatory
		serverToken = '';
	}

	if (!params){ // params is not mandatory
		params = '';
	}

	//To do: do other checks like get API version, get that its HTTP Post, check HTTPS

	if (dataOk) {

		HandlerEndPoints.findOneAndUpdate({clientID: clientID}, {name: name, hostURI: hostURI, serverToken: serverToken, params: params, isActive: "true"}, {upsert: true},function(ex2, result) {
			if(ex2){
				res.end ('Error creating API Host : ' + ex2);
				res.statusCode = ERROR_RESPONSE_CODE;
				logger.error('Error creating API Host : ' + ex2);
			}else{
				
				res.end ('OK');
				//Todo: set response type to json
				//update cache
				cache.hmset(CACHE_PREFIX + 'client:' + clientID, 'name', name, 'hostURI', hostURI, 'serverToken', serverToken, 'params', params);
				
				logger.info("Valid request received!!! ");

			}
		});

	} else {
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});


router.get('/getoauth', function(req, res) {
	
	var error = req.query.error;
		
	if (error) {
		errmsg = 'Authentication Error: ' + error + " Error reason: " + req.query.error_reason + ", " + req.query.error_description;
		res.end (responseHTML.replace("@message",errmsg).replace("@color","red"));
		logger.error(errmsg);
	}else {
		var temporaryCode = req.query.code; // use temporary code that instagram gives you to use to extract the token
		logger.info('Temporary instagram code obtained: ' + temporaryCode);

		//Get client ID and userID from redirected end point 
		var clientID = req.query.clientID;
		var userID = req.query.userID;
		
		//Get Handler endpoint from cache
		cache.hgetall(CACHE_PREFIX + 'client:' + clientID, function (err, handlerEndPoint) {
			
			//1. Check that piper client is valid client.
			if((err) || (handlerEndPoint == null)){
				errmsg = 'Settings not found Client: ' + clientID;
				res.end (responseHTML.replace("@message",errmsg).replace("@color","red"));
				logger.info(errmsg);
			}else{
				var params = {};
				var instagram_redirect_uri = '';
				try {
					params = JSON.parse(handlerEndPoint.params);
					instagram_redirect_uri = params.instagram_redirect_uri.replace("@cid", clientID).replace("@uid", userID);
				}catch(ex){
					logger.error('Could not obtain params for handler end point: ' + ex);
				}

				
				request.post(
				    handlerEndPoint.hostURI + '/oauth/access_token',
				    { form: { 
				    	client_id: params.instagram_client_id, 
						client_secret: params.instagram_client_secret, 
						grant_type: "authorization_code", 
						redirect_uri: instagram_redirect_uri, 
						code: temporaryCode 
					} },
				    function (error, response, body) {
				        
				    	if (error){
				    		errmsg = "Instagram authentication Error: " + error;
				            logger.info(errmsg);
				            res.end (responseHTML.replace("@message",errmsg).replace("@color","red"));
				    	} else if (response && response.statusCode != 200) {
				    		errmsg = "Instagram authentication Error: Invalid response: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";
				    		logger.info(errmsg);
				            res.end (responseHTML.replace("@message",errmsg).replace("@color","red"));
				        }else{
				        	
				        	var access_token = (JSON.parse(body)).access_token;
							
							//Todo: consider also updating Mongo DB with the same information. 
							//update cache with user's access token
							cache.hmset(CACHE_PREFIX + 'user:' + userID + "@" + clientID, 'access_token', access_token);  
							
				        	msg = "Congratulations, you have successfully registered for this service. You can now use piper access Instagram";
				        	res.end (responseHTML.replace("@message",msg).replace("@color","black"));

				        	logger.info("Token obtained: " + access_token + " for " + userID + "@" + clientID);

				        }

				    }
				);

			}
		});

		//https://api.instagram.com/oauth/authorize/?client_id=03c54c6e8db94a34a3ab146cf997504a&redirect_uri=http%3A%2F%2Fpiperlabs.io%3A3001%2Fgetoauth%2F%3FclientID%3Dc2g%26userID%3Dmichaelukpong&response_type=code		
	}
});

router.get('/timeline', function(req, res) {

	
	var userID = req.query.userID,
		clientID = req.query.clientID;

	var dataOk = true,
	invalidParam = '';
		
	if (!userID) {
		dataOk = false;
		invalidParam = 'userID';
	}else if (!clientID) {
		dataOk = false;
		invalidParam = 'clientID';
	}


	if (dataOk) {

		//1. Check that piper client is valid client.
		cache.hgetall(CACHE_PREFIX + 'client:' + clientID, function (err, handlerEndPoint) {

			if((err) || (handlerEndPoint == null)){
				res.statusCode = ERROR_RESPONSE_CODE;
				res.end ('Settings not found for Client: ' + clientID);
				logger.error('Settings not found Client: ' + clientID);
			}else{

				cache.hgetall(CACHE_PREFIX + 'user:' + userID  + '@' + clientID, function (err, user) {

					if((err) || (user == null)){

						params = JSON.parse(handlerEndPoint.params);
						instagram_redirect_uri = encodeURIComponent(params.instagram_redirect_uri.replace("@cid", clientID).replace("@uid", userID));
						handlerEndPoint.hostURI + '/oauth/authorize/?client_id=' + params.instagram_client_id + '&redirect_uri=' + instagram_redirect_uri + '&response_type=code';

						var oauthURI = handlerEndPoint.hostURI + '/oauth/authorize/?client_id=' + params.instagram_client_id + '&response_type=code&redirect_uri=' + instagram_redirect_uri;		
						msg = 'You have to permit Piper to access Instagram. Don\'t worry, you only have to do this once. Click <a href=\'@oauthURI\'>this link to do this</a>';
						msg = msg.replace("@oauthURI", oauthURI);
						res.end (responseHTML.replace("@message",msg).replace("@color","black"));
						logger.error('Settings not found User: ' + userID + " Error: " + err);
							
					}else{


	        			var options = {
				            url: handlerEndPoint.hostURI + '/v1/users/self/feed?access_token=' + user.access_token
				        };
	      

					    request(options, function (error, response, body) {

					    	if (error){
					    		errmsg = "Cannot get timeline from Instagram: " + error;
					            logger.info(errmsg);
					            res.end (errmsg);
					    	} else if (response && response.statusCode != 200) {
					    		errmsg = "Cannot get timeline from Instagram: Invalid response: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";
					    		logger.info(errmsg);
					            res.end (errmsg);
					        }else{
					        	var data = (JSON.parse(body)).data;
					        	var i
					        	var msg = ''
					        	for (i in data) {
    								if (data[i].type == 'image'){
    									msg = msg + "<p><img height=\"100\" width=\"100\" src=\"" + data[i].images['standard_resolution'].url + "\"></p>"
    								}
								}
					        	
					        	res.end (responseHTML.replace("@message",msg).replace("@color","black"));
								//logger.info("Timeline Obtained: " + JSON.stringify(body));

					        }
					        
					    });
						
					}	
				});
			}

		});

		
		//2. Check that we have valid client token


	} else {
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});

router.get('/verify', function(req, res) {

	
	var userID = req.query.userID,
		clientID = req.query.clientID;

	var dataOk = true,
	invalidParam = '';
		
	if (!userID) {
		dataOk = false;
		invalidParam = 'userID';
	}else if (!clientID) {
		dataOk = false;
		invalidParam = 'clientID';
	}


	if (dataOk) {

		//1. Check that piper client is valid client.
		cache.hgetall(CACHE_PREFIX + 'client:' + clientID, function (err, handlerEndPoint) {

			if((err) || (handlerEndPoint == null)){
				res.statusCode = ERROR_RESPONSE_CODE;
				res.end ('Settings not found for Client: ' + clientID);
				logger.error('Settings not found Client: ' + clientID);
			}else{

				cache.hgetall(CACHE_PREFIX + 'user:' + userID  + '@' + clientID, function (err, user) {

					if((err) || (user == null)){

						params = JSON.parse(handlerEndPoint.params);
						instagram_redirect_uri = encodeURIComponent(params.instagram_redirect_uri.replace("@cid", clientID).replace("@uid", userID));
						handlerEndPoint.hostURI + '/oauth/authorize/?client_id=' + params.instagram_client_id + '&redirect_uri=' + instagram_redirect_uri + '&response_type=code';

						var oauthURI = handlerEndPoint.hostURI + '/oauth/authorize/?client_id=' + params.instagram_client_id + '&response_type=code&redirect_uri=' + instagram_redirect_uri;		
						msg = 'You have to permit Piper to access Instagram. Don\'t worry, you only have to do this once. Click <a href=\'@oauthURI\'>this link to do this</a>';
						msg = msg.replace("@oauthURI", oauthURI);
						res.end (responseHTML.replace("@message",msg).replace("@color","black"));
						logger.error('Settings not found User: ' + userID + " Error: " + err);
							
					}else{


					var fs1 = require('fs');					
					var bufferString, lines;
					fs1.readFile("/tmp/accounts.csv", function (err, data) {
					    bufferString = data.toString(); 
					    lines = bufferString.split('\n'); 
						for (i = 0; i < lines.length; i++) { 
						    logger.info('Document Lines: ' + lines[i]);
						}
					 });

					res.end ("Hello");

/**

	        			var options = {
				            url: handlerEndPoint.hostURI + '/v1/users/search?q=neoterabyte_&count=1&access_token=' + user.access_token
				        };
	      

					    request(options, function (error, response, body) {

					    	if (error){
					    		errmsg = "Cannot get timeline from Instagram: " + error;
					            logger.info(errmsg);
					            res.end (errmsg);
					    	} else if (response && response.statusCode != 200) {
					    		errmsg = "Cannot get timeline from Instagram: Invalid response: " + http.STATUS_CODES[response.statusCode] + " (" + response.statusCode + ")";
					    		logger.info(errmsg);
					            res.end (errmsg);
					        }else{
					        	var data = (JSON.parse(body)).data;
					        	msg = "<p><img height=\"100\" width=\"100\" src=\"" + data[0].profile_picture + "\"></p>"
					        	
					        	res.end (responseHTML.replace("@message",msg).replace("@color","black"));
					        	//res.end (body);
								
					        }
					        
					    });
*/
						
					}	
				});
			}

		});

		
		//2. Check that we have valid client token


	} else {
		res.statusCode = ERROR_RESPONSE_CODE;
		res.end ('Missing parameter for: ' + invalidParam);
		logger.error("Missing parameter for: " + invalidParam);
	}
});



// Register all our routes with /
app.use('/', router);



