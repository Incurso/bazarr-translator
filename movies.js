import config from './config.js'

const log = function () {
  const first_parameter = arguments[0];
  const other_parameters = Array.prototype.slice.call(arguments, 1);

  function formatConsoleDate(date) {
    const HH = date.getHours();
    const mm = date.getMinutes();
    const ss = date.getSeconds();
    const SSS = date.getMilliseconds();

    return `[${(HH < 10 ? '0' + HH : HH)}:${(mm < 10 ? '0' + mm : mm)}:${(ss < 10 ? '0' + ss : ss)}.${('00' + SSS).slice(-3)}] `;
  }

  console.log.apply(console, [formatConsoleDate(new Date()) + first_parameter].concat(other_parameters));
};

const headers = {
  accept: 'application/json',
  'Content-Type': 'application/json',
  'X-API-KEY': config.API_KEY
}

console.time('GET Movies')
log('Fetching movies with missing subtitles')

const movies = await fetch(`http://${config.HOST}:${config.PORT}/api/movies/wanted`, {method: 'GET', headers })
  .then(async data => (await data.json()).data)
  .catch((err) => { throw err })

if (config.DEBUG) console.debug('DEBUG', movies)

console.timeEnd('GET Movies')

// Sort by movie title in alphabetical order
movies.sort((a, b) => {
  const titleA = a.title.toLowerCase().replace(/^The |^A /i, '')
  const titleB = b.title.toLowerCase().replace(/^The |^A /i, '')

  if (titleA < titleB) return -1
  if (titleA > titleB) return 1

  return 0
})

const missing_isl = []


for (const m of movies) {
  let movie = await fetch(`http://${config.HOST}:${config.PORT}/api/movies?radarrid[]=${m.radarrId}`, { method: 'GET', headers })
    .then(async data => (await data.json()).data[0])
    .catch(err => console.error(`Unable to fetch movie data from Bazarr: ${err}`))

  if (config.DEBUG) console.debug('DEBUG', movie)

  if (movie === undefined) {
    log('Failed to get movie data, skipping...')
    continue
  }

  let missing_subtitles = movie.missing_subtitles
  let subtitles = movie.subtitles?.filter(s => s.path !== null && s.code2 === 'en')

  if (config.SEARCH && subtitles.length === 0) {
    console.time(`Searched subs for ${movie.title} (${movie.year})`)
    log(`Searching subs for ${movie.title} (${movie.year})`)

    const subs = await fetch(`http://${config.HOST}:${config.PORT}/api/providers/movies?radarrid=${m.radarrId}`, { method: 'GET', headers})
      .then(async data => (await data.json()).data)
      .catch(err => console.error(`Unable to search subs form movie ${movie.title} (${movie.year}) from Bazarr: ${err}`))

    if (config.DEBUG) console.debug('DEBUG', subs)

    console.timeEnd(`Searched subs for ${movie.title} (${movie.year})`)

    // Skip if search failed
    if (!subs) {
      log('Failed to search subs, skipping...')
      continue
    }
    
    // Skip if no subtitles were found
    if (subs.length === 0) { // || subs.filter(s => s.provider === 'embeddedsubtitles').length === 0) {
      log(`Found ${subs.length} subtitles`)
      continue
    }
    
    let sub = subs.filter(s => s.provider === 'embeddedsubtitles').shift() || subs.shift()
    log(`Found ${subs.length + 1} subtitles with the highest score of ${sub.score} from ${sub.provider}`)

    // Skip if subtitle score is bwlow MINIMUM_SCORE
    if (sub.score < config.MINIMUM_SCORE) {
      log(`Subtitle score of ${sub.score} is lower than minimum score of ${config.MINIMUM_SCORE}, skipping...`)
      continue
    }

    console.time(`Downloaded subs for ${movie.title} (${movie.year})`)
    log(`Downloading subs for ${movie.title} (${movie.year})`)
    
    const data = {
      hi: sub.hearing_impaired,
      forced: sub.forced,
      original_format: sub.original_format,
      provider: sub.provider,
      subtitle: sub.subtitle
    }

    await fetch(`http://${config.HOST}:${config.PORT}/api/providers/movies?radarrid=${m.radarrId}`, { method: 'POST', headers, body: JSON.stringify(data), signal: AbortSignal.timeout(180000) })
      .then(async data => {
        console.timeEnd(`Downloaded subs for ${movie.title} (${movie.year})`)
        return (await data.json()).data
      })
      .catch(() => console.error('Download taking to long skipping'))

    movie = await fetch(`http://${config.HOST}:${config.PORT}/api/movies?radarrid[]=${m.radarrId}`, { method: 'GET', headers})
      .then(async data => (await data.json()).data[0])
      .catch(err => console.error(`Unable to re-fetch movie data from Bazarr: ${err}`))

    // If getting movie data failed skip
    if (!movie) continue

    missing_subtitles = movie.missing_subtitles
    subtitles = movie.subtitles.filter(s => s.path !== null)
  }

  // Skip movie if there are no subtitles
  if (missing_subtitles.length === 0) continue
  // Skip movie if there are no subtitles
  if (subtitles.length === 0) continue
  // Skip movie if there is no english subtitle
  if (subtitles.filter(s => s.code2 === 'en').length === 0) continue

  if (missing_subtitles.filter(s => s.code2 === 'is')) {
    missing_isl.push(movie)

    console.time(`Translated sub for ${movie.title} (${movie.year})`)
    log(`Translating sub for ${movie.title} (${movie.year})`)

    const data = {
      language: 'is',
      path: subtitles[0].path,
      type: 'movie',
      id: movie.radarrId
    }

    await fetch(`http://${config.HOST}:${config.PORT}/api/subtitles?action=translate`, { method: 'PATCH', body: JSON.stringify(data), headers })
      .catch(err => console.error(`Failed to translate subtitle: ${err}`))
    
    console.timeEnd(`Translated sub for ${movie.title} (${movie.year})`)
  }
}

console.log('Movies with missing IS subtitles', missing_isl.length)
