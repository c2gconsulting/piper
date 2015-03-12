var Cleverbot = require('./cleverbot');
var CBots = [new Cleverbot,new Cleverbot]
  , i = 0
  , name = ['Bob Loblaw', 'Stan Sitwell']
  , callback = function callback(err,resp){
    CBots[i].write(resp,callback);
    console.log(name[i = ( ( i + 1 ) %2)],' : ',  resp)
  };

callback('','Sup you');