var mongoose = require('mongoose');

// Create a new schema for our data
var schema = new mongoose.Schema({
    email           : String
  , createdAt       : { type: Date, default: Date.now }
  , access_token    : String
  , refresh_token   : String
  , token_scope     : String
  , tokenExpiry     : Date
  , preferences     : [{
      pKey   : String
    , pValue : String
  }]
});

// Static methods
schema.statics.getUserByID = function(id, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  UberUser.findOne({ '_id' : id }).exec( function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
  
  return promise;

}

schema.statics.getUserByEmail = function(email, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  UberUser.findOne({ 'email' : email }).exec( function(err, doc) {
     if (err) {
      promise.error(err);
      return;
    } 
    promise.complete(doc);
  });
 
  return promise;

}


schema.statics.getUserPreference = function(email, prefKey, callback) {
  var promise = new mongoose.Promise;
  if(callback) promise.addBack(callback);

  UberUser.findOne({ 'email' : email, 'preferences.pKey' : prefKey }).exec( function(err, doc) {
    if (err) {
      promise.error(err);
      return;
    } 
    if (doc) {
      var prefs = doc.preferences;
      var thePref;
      prefs.forEach(function(pref) {
        if (pref.pKey === prefKey) {
          thePref = pref;
        }
      });
      promise.complete(thePref);
    } else {
      promise.complete(doc);
    }  
  });
 
  return promise;

}



// Return a UberUser model based upon the defined schema
module.exports = UberUser = mongoose.model('uberusers', schema);


