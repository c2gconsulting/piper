curl -XPOST 'https://api.wit.ai/intents?v=20141022' \
  -H "Authorization: Bearer AQOYK6OZNJMM6X6ELUK2NE2RGT5GMURC" \
  -H "Content-Type: application/json" \
  -d '{"name":"rides_confirm_booking",
       "doc":"Confirm booking of a ride request",
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