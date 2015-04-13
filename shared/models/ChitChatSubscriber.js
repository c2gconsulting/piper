var mongoose = require('mongoose');
var logger = require('../lib/log');


// Create a new schema for our tweet data
var schema = new mongoose.Schema({
    handle          : String
  , createdAt       : { type: Date, default: Date.now }
});

// Static methods
schema.statics.getSubscribers = function(callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  ChitChatSubscriber.find({}).exec( function(err, docs) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(docs);
  });
  
  return promise;

}

// Return a User model based upon the defined schema
module.exports = ChitChatSubscriber = mongoose.model('chitchat_subscribers', schema);


