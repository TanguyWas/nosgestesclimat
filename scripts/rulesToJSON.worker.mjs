import fs from 'fs'
import c from 'ansi-colors'
import cli from '@incubateur-ademe/nosgestesclimat-scripts/cli'
import utils from '@incubateur-ademe/nosgestesclimat-scripts/utils'
import { disabledLogger } from '@publicodes/tools'
import path from 'path'
import Engine from 'publicodes'
import { addRegionToBaseRules } from './i18n/addRegionToBaseRules.js'
import { defaultModelCode, regionModelsPath } from './i18n/regionCommons.js'
import { compressRules } from './modelOptim.mjs'

function getStyledReportString(name, verb, nbRules, duration) {
  return `✅ ${c.green(name)} ${verb} (${c.yellow(
    nbRules
  )} rules) in ${c.magenta(duration)} ms`
}

function writeRules(rules, path, destLang, regionCode, markdown) {
  try {
    const start = Date.now()
    fs.writeFileSync(path, JSON.stringify(rules, null, 2))
    const timeElapsed = Date.now() - start
    if (!markdown) {
      console.log(
        getStyledReportString(
          `${regionCode}-${destLang}`,
          'written',
          Object.keys(rules).length,
          timeElapsed
        )
      )
    }
  } catch (err) {
    return err
  }
}

function getLocalizedRules(translatedBaseRules, regionCode, destLang) {
  if (regionCode === defaultModelCode) {
    return translatedBaseRules
  }
  try {
    const localizedAttrs = utils.readYAML(
      path.join(regionModelsPath, `${regionCode}-${destLang}.publicodes`)
    )
    return addRegionToBaseRules(translatedBaseRules, localizedAttrs)
  } catch (err) {
    cli.printWarn(`[SKIPPED] - ${regionCode}-${destLang} (${err.message})`)
    return addRegionToBaseRules(translatedBaseRules, {})
  }
}

export default ({
  regionCode,
  destLang,
  translatedBaseRules,
  markdown = false
}) => {
  const localizedTranslatedBaseRules = getLocalizedRules(
    translatedBaseRules,
    regionCode,
    destLang
  )
  const destPathWithoutExtension = path.resolve(
    `public/co2-model.${regionCode}-lang.${destLang}`
  )
  const engine = new Engine(localizedTranslatedBaseRules, {
    logger: disabledLogger
  })
  writeRules(
    localizedTranslatedBaseRules,
    destPathWithoutExtension + '.json',
    destLang,
    regionCode,
    markdown
  )
  const start = Date.now()
  const nbRules = compressRules(engine, destPathWithoutExtension)
  const optimDuration = Date.now() - start

  if (!markdown) {
    console.log(
      getStyledReportString(
        `${regionCode}-${destLang}`,
        'optimized',
        nbRules,
        optimDuration
      )
    )
  }

  return `<li>${regionCode}-${destLang}</li>`
}
