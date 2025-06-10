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

console.time('GET Episodes')
log('Fetching episodes with missing subtitles')

const episodes = await fetch(`http://${config.HOST}:${config.PORT}/api/episodes/wanted`, { method: 'GET', headers })
  .then(async data => (await data.json()).data)
  .catch(err => { throw err.message })

if (config.DEBUG) console.debug('DEBUG', episodes)

console.timeEnd('GET Episodes')

// Sort by episode title in alphabetical order
episodes.sort((a, b) => {
  const titleA = `${a.seriesTitle.toLowerCase()}.${a.episode_number}`.replace(/^The |^A /i, '')
  const titleB = `${b.seriesTitle.toLowerCase()}.${b.episode_number}`.replace(/^The |^A /i, '')
  
  if (titleA < titleB) return -1
  if (titleA > titleB) return 1
  
  return 0
})

const missing_isl = []

for (const e of episodes) {
  let episode = await fetch(`http://${config.HOST}:${config.PORT}/api/episodes?episodeid[]=${e.sonarrEpisodeId}`, { method: 'GET', headers})
    .then(async data => (await data.json()).data[0])
    .catch(err => console.error(`Unable to fetch episode data from Bazarr: ${err}`))

  if (episode === undefined) {
    log('Failed to get episode data, skipping...')
    continue
  }
  
  let missing_subtitles = episode.missing_subtitles
  let subtitles = episode.subtitles.filter(s => s.path !== null && s.code2 === 'en')
  
  if (config.SEARCH && subtitles.length === 0) {
    console.time(`Searched subs for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)
    log(`Searching subs for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)
    
    const subs = await fetch(`http://${config.HOST}:${config.PORT}/api/providers/episodes?episodeid=${e.sonarrEpisodeId}`, { method: 'GET', headers })
      .then(async data => (await data.json()).data)
      .catch(err => console.error(`Unable to search subs for episode ${e.SeriesTitle} (${e.episode_number}) ${e.episodeTitle} from Bazarr: ${err}`))

    console.timeEnd(`Searched subs for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)
    
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
    log(`Found ${subs.length + 1} subtitles with the hightest score of ${sub.score} from ${sub.provider}`)

    // Skip if subtitle score is bwlow MINIMUM_SCORE
    if (sub.score < config.MINIMUM_SCORE) {
      console.log(`Subtitle score of ${sub.score} is lower than minimun score of ${config.MINIMUM_SCORE}, skipping...`)
      continue
    }

    console.time(`Downloaded subs for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)
    log(`Downloading subs for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)

    const data = {
      hi: sub.hearing_impaired,
      forced: sub.forced,
      original_format: sub.original_format,
      provider: sub.provider,
      subtitle: sub.subtitle
    }

    await fetch(`http://${config.HOST}:${config.PORT}/api/providers/episodes?seriesid=${e.sonarrSeriesId}&episodeid=${e.sonarrEpisodeId}`, { method: 'POST', headers, body: JSON.stringify(data), signal: AbortSignal.timeout(180000) })
      .then(async data => {
        console.timeEnd(`Downloaded subs for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)
        return (await data.json()).data
      })
      .catch(() => { console.error('Download taking to long skipping') })

    episode = await fetch(`http://${config.HOST}:${config.PORT}/api/episodes?episodeid[]=${e.sonarrEpisodeId}`, { method: 'GET', headers })
      .then(async data => (await data.json()).data[0])
      .catch(err => console.error(`Unable to re-fetch episode data from Bazarr: ${err}`))

    // If getting episode data failed skip
    if (!episode) continue

    missing_subtitles = episode.missing_subtitles
    subtitles = episode.subtitles.filter(s => s.path !== null)
  }

  // Skip movie if there are no subtitles
  if (missing_subtitles.length === 0) continue
  // Skip movie if there are no subtitles
  if (subtitles.length === 0) continue
  // Skip movie if there is no english subtitle
  if (subtitles.filter(s => s.code2 === 'en').length === 0) continue

  if (missing_subtitles.filter(s => s.code2 === 'is')) {
    missing_isl.push(episode)

    console.time(`Translated sub for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)
    log(`Translating sub for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)

    const data = {
      language: 'is',
      path: subtitles[0].path,
      type: 'episode',
      id: episode.sonarrEpisodeId
    }

    await fetch(`http://${config.HOST}:${config.PORT}/api/subtitles?action=translate`, { method: 'PATCH', body: JSON.stringify(data), headers })
      .catch(err => { console.error(`Error translating sub for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}: ${err.message}`) })
    
    console.timeEnd(`Translated sub for ${e.seriesTitle} (${e.episode_number}) ${e.episodeTitle}`)
  }
}

console.log('Episodes with missing IS subtitles', missing_isl.length)
