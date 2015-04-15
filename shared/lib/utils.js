// Convert Date String in ISO format to JavaScript Date
exports.dateFromISOString = function(date, callback) {
  
  var dateString = date.replace(/\D/g," ");
  var dateComponents = dateString.split(" ");

  // modify month between 1 based ISO 8601 and zero based Date
  dateComponents[1]--;

  var convertedDate = new Date (Date.UTC(dateComponents[0],dateComponents[1],dateComponents[2],dateComponents[3],dateComponents[4]));
  
  callback(convertedDate);

}


exports.getAbsoluteURL = function(path, module) {
	return 'http://mobilizr.net';
}






