;(function () {
  'use strict'

  var net = require('net')

  var server = net.createServer(function (socket) {
    var buffer = ''

    socket.setEncoding('utf8')

    socket.on('data', function (chunk) {
      buffer += chunk

      var newline = buffer.indexOf('\n')

      while (newline >= 0) {
        var line = buffer.slice(0, newline)
        var reply

        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        try {
          var request = JSON.parse(line)

          try {
            reply = { id: request.id, ok: true, value: String(window.eval(request.code)) }
          } catch (error) {
            reply = { id: request.id, ok: false, error: String((error && error.message) || error) }
          }
        } catch (ignored) {
          continue
        }

        socket.write(JSON.stringify(reply) + '\n')
      }
    })

    socket.on('error', function () {})
  })

  server.on('error', function () {})
  server.listen(__WENBU_PORT__, '127.0.0.1')
})()
