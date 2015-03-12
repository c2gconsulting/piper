var run = function(body, user, client, callback) {
	var Cleverbot = require('./cleverbot');
	var cBot = new Cleverbot();
  	cBot.write(body._text, callback);
}

module.exports.run = run;