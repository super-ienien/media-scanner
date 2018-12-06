/**
 * The purpose of this file is to make occasional checks if media-scanner behaves as it should.
 * If it doesn't, kill the process and let the parent process restart it.
 */
const PouchDB = require('pouchdb-node')
const fs = require('fs')
const config = require('./config')

/** How often to run the watchdog */
const CHECK_INTERVAL = 5 * 60 * 1000
/** Maximum time to expect the changes in the database */
const EXPECT_TIME = 10 * 1000

const WATCHDOG_FILE = 'watchdog.mov'

async function cleanUpOldWatchdogFiles (logger, path) {

    try {

        const files = await promisify(fs.readdir, path)
        for (let i in files) {
            let fileName = files[i]

            // Find any old watchdog files and remove them:
            if (fileName.match(/_watchdogIgnore_/i)) {

                const filePath = `${path}/${fileName}`

                logger.info('Watchdog: Removing old file ' + fileName)
                await promisify(fs.unlink, filePath)
                
            }
        }
    } catch (err) {
        logger.error(err)
    }
}

async function doWhatWatchDogsDo (logger, db, path, fileName) {
    
    const copyFileName = fileName.replace(/(.+)\.([^.]+)$/, `$1_watchdogIgnore_${Date.now()}.$2`)

    const inputPath = `${path}/${fileName}`
    const outputPath = `${path}/${copyFileName}`

    logger.info('Watchdog check')

    let createdFileId = null
    let createFileResolve = null
    function hasCreatedFile (id) {
        // Called when the file has appeared
        createdFileId = id
        if (createFileResolve) {
            createFileResolve()
            createFileResolve = null
        }
    }
    let removeFileResolve = null
    function hasRemovedFile () {
        // Called when the file has appeared
        createdFileId = null
        if (removeFileResolve) {
            removeFileResolve()
            removeFileResolve = null
        }
    }

    // Clean up old files created by old watchdog runs:
    await cleanUpOldWatchdogFiles(logger, path)

    // Watch the pouchdb for changes:
    db.changes({
        since: 'now',
        include_docs: true,
        live: true,
        attachments: false
    }).on('change', (changes) => {
        if (changes.deleted) {
            if (changes.id === createdFileId) {
                hasRemovedFile()
            }
        } else if (changes.doc) {
            let mediaPath = changes.doc.mediaPath

            if (mediaPath.match(new RegExp(copyFileName, 'i')) ) {
                hasCreatedFile(changes.id)
            }
        }
    })


    // First, we make a copy of a file, and expect to see the file in the database later:

    logger.info('Watchdog: Copy file ' + copyFileName)
    // Copy the file
    await promisify(fs.copyFile, inputPath, outputPath)
    
    logger.info('Watchdog: wait for changes')
    // Wait for the change in pouchdb
    await new Promise((resolve, reject) => {
        createFileResolve = resolve
        setTimeout(() => {
            reject('Timeout: Created file didnt appear in database')
        }, EXPECT_TIME)
    })

    // Then, we remove the copy and expect to see the file removed from the database
    logger.info('Watchdog: remove file')
    // Remove the file
    await promisify(fs.unlink, outputPath)
    
    logger.info('Watchdog: wait for changes')
    // Wait for the change in pouchdb
    await new Promise((resolve, reject) => {
        removeFileResolve = resolve
        setTimeout(() => {
            reject('Timeout: Removed file wasnt removed from database')
        }, EXPECT_TIME)
    })
    
    // Looks good at this point.
}

function promisify (fcn) {
    let args = []
    for (let i in arguments) {
        args.push(arguments[i])
    }
    args.splice(0, 1)

    
    return new Promise((resolve, reject) => {
        args.push((err, result) => {
            if (err) reject(err)
            else resolve(result)
        })
        fcn.apply(this, args)
    })
}

module.exports = function startWatchDog(logger, db) {
    const basePath = config.scanner.paths
    const path = `${basePath}/${WATCHDOG_FILE}`

    // We're using a filed calle "watchdog.mov" to do the watchdog routine
    fs.exists(path, (exists) => {

        if (exists) {
            // Start the watchdog:
            const triggerWatchDog = () => {
                doWhatWatchDogsDo(logger, db, basePath, WATCHDOG_FILE)
                .then(() => {
                    logger.info('Watchdog ok')
                })
                .catch(err => {
                    if (err.toString().match(/Timeout:/)) {
                        logger.error(err)
                        logger.info(`Watchdog failed, shutting down!`)
                        setTimeout(() => {
                            process.exit(1)
                        }, 1 * 1000)
                    } else {
                        logger.error('Error in watchdog:')
                        logger.error(err)
                    }
                })
            }
            setInterval(triggerWatchDog, CHECK_INTERVAL)
            triggerWatchDog()
        } else {
            logger.warn(`Watchdog is disabled because ${path} wasn't found`)
        }
    })
}
