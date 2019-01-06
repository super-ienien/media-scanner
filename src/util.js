const path = require('path')

module.exports = {
  getId (fileDir, filePath) {
    return path
      .relative(fileDir, filePath)
      .replace(/\.[^/.]+$/, '')
      .replace(/\\+/g, '/')
      .toUpperCase()
  },
  getMediaJsonFromDoc (doc) {
    const cinf = doc.cinf.split(' ')
    return {
      id: doc._id,
      file: doc.mediaPath,
      time: doc.mediaTime,
      size: doc.mediaSize,
      type: cinf[1],
      changed: cinf[3],
      duration: cinf[4],
      timebase: cinf[5].split('/')
    }
  },
  getThumbJsonFromDoc (doc) {
    return {
      id: doc._id,
      path: `thumbnail/${doc._id}.png`,
      time: doc.thumbTime,
      size: doc.thumbSize
    }
  }
}
