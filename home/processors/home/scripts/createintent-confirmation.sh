curl -XPOST 'https://api.wit.ai/intents?v=20141022' \
  -H "Authorization: Bearer QJKD3F66M5PUDUCYVUHS6QQ5HYVUJUWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"default_confirm",
       "doc":"Confirm yes or no",
       "expressions":[{
          "body" : "no don\u0027t"
        }, {
          "body" : "no chill"
        }, {
          "body" : "naa chill"
        }, {
          "body" : "hold on, don’t cancel"
        }, {
          "body" : "definitely not"
        }, {
          "body" : "please go ahead"
        }, {
          "body" : "yea sure"
        }, {
          "body" : "go ahead"
        }, {
          "body" : "yup you can"
        }, {
          "body" : "yea go on"
        }, {
          "body" : "oh sure"
        }, {
         "body" : "oh yea sure"
        }, {
          "body" : "oh yea"
        }, {
          "body" : "yes"
        }, {
          "body" : "nope"
        }, {
          "body" : "??"
        }, {
         "body" : "?"
        }, {
          "body" : "pardon?"
        }, {
          "body" : "excuse me?"
        }, {
          "body" : "sorry, what?"
        }, {
          "body" : "sorry?"
        }, {
          "body" : "what?"
        }, {
          "body" : "i dont get"
        }, {
         "body" : "what do you mean?"
        }, {
         "body" : "huh?"
        }, {
         "body" : "yea, go ahead"
        }, {
         "body" : "hell yea"
        }, {
         "body" : "please do"
        }, {
         "body" : "absolutely"
        }, {
         "body" : "please don\u0027t"
        }, {
         "body" : "hell no"
        }, {
         "body" : "of course not"
        }, {
         "body" : "sure"
        }, {
         "body" : "naaa"
        }, {
         "body" : "yea"
        }, {
         "body" : "ok"
        }, {
         "body" : "no"
        }]}'