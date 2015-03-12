var run = function (body, user, client, callback) {
	console.log("Processor: CUSTOMER_ANALYTICS");
	error = '';
	callback(error, 'So you want to predict the future?');


	// Retrieve entities
	var outcomes = body.outcomes;

}

module.exports.run = run;

function addDuration(date, seconds) {
	var days = seconds / 86400;
    var result = new Date(date);
    result.setDate(date.getDate() + days);
    return result;
}


  