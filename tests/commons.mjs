import { disabledLogger } from '@publicodes/tools'
import {
  defaultLang,
  availableLanguages
} from '@incubateur-ademe/nosgestesclimat-scripts/utils'
import Engine from 'publicodes'
import c from 'ansi-colors'
import yargs from 'yargs'
import { readFile } from 'fs/promises'

const API_URL = 'https://nosgestesclimat-api.osc-fr1.scalingo.io'

export function getArgs() {
  return yargs(process.argv.slice(2))
    .version(false)
    .usage('Compare local and prod personas results\n\nUsage: $0 [options]')
    .option('country', {
      alias: 'c',
      describe: 'Target country code',
      type: 'string',
      default: 'FR'
    })
    .option('language', {
      alias: 'l',
      describe: 'Target language code',
      type: 'string',
      default: defaultLang,
      choices: availableLanguages
    })
    .option('markdown', {
      alias: 'm',
      type: 'boolean',
      description: 'Prints the result in a Markdown table format.'
    })
    .option('version', {
      alias: 'v',
      type: 'string',
      description: 'The version of the model to test agains (default: nightly)',
      default: 'nightly'
    })
    .option('persona', {
      alias: 'p',
      type: 'string',
      description: 'Test only one persona'
    })

    .help('h')
    .alias('h', 'help').argv
}

export function getLocalRules(region, lang, optim = false) {
  return readFile(
    `./public/co2-model.${region}-lang.${lang}${optim ? '-opti' : ''}.json`,
    {
      encoding: 'utf8'
    }
  )
    .then((res) => JSON.parse(res))
    .catch((e) => {
      console.error(`No local rules found for ${region} and ${lang}`)
      console.error(e.message)
      process.exit(-1)
    })
}

export function getLocalPersonas(region, lang) {
  return readFile(`./public/personas-${lang}.json`, {
    encoding: 'utf8'
  })
    .then((res) => JSON.parse(res))
    .catch((e) => {
      console.error(`No local personas found for ${region} and ${lang}:`)
      console.error(e.message)
      process.exit(-1)
    })
}

export function getRulesFromAPI(version, region, lang) {
  return fetch(`${API_URL}/${version}/${lang}/${region}/rules`)
    .then((res) => res.json())
    .catch((e) => {
      console.error(
        `No prod rules found for ${region} and ${lang} (${version}):`
      )
      console.error(e.message)
      process.exit(-1)
    })
}

export function getPersonasFromAPI(version, region, lang) {
  return fetch(`${API_URL}/${version}/${lang}/personas`)
    .then((res) => res.json())
    .catch((e) => {
      console.error(
        `No prod personas found for ${region} and ${lang} (${version}):`
      )
      console.error(e.message)
      process.exit(-1)
    })
}

export function testPersonas(rules, personas) {
  const engine = new Engine(rules, {
    logger: disabledLogger,
    allowOrphanRules: true
  })
  const personasRules = Object.values(personas)
  const results = {}

  for (const persona of personasRules) {
    let personaData = persona.situation || {}
    for (const ruleName in personaData) {
      if (!(ruleName in rules)) {
        delete personaData[ruleName]
      }
    }
    engine.setSituation(personaData)
    results[persona.nom] = {}
    for (const rule in rules) {
      results[persona.nom][rule] = engine.evaluate(rule).nodeValue
    }
  }

  return results
}

const kgCO2Str = c.dim('(kg CO2e)')

// TODO: could be improved by using a more generic way to compare results.
export function printResults(
  localResults,
  prodResults,
  markdown,
  version,
  withOptim = false
) {
  if (markdown) {
    console.log(
      `| Persona | Total PR ${
        withOptim ? 'with optim.' : ''
      } (kg CO2e) | Total ${
        withOptim ? 'PR without optim.' : 'in prod.'
      } (kg CO2e) | Δ (%) |`
    )
    console.log('|-----:|:------:|:------:|:----:|')
  } else {
    const title = withOptim
      ? "Test model optimisation (only evaluating 'bilan')"
      : `Test personas regression against ${c.green(version)}`
    console.log(`[ ${title} ]\n`)
  }
  const fails = []
  const nbTests = Object.keys(localResults).length
  for (let name in localResults) {
    const localResult = Math.fround(localResults[name])
    const prodResult = Math.fround(prodResults[name])
    const diff = localResult - prodResult
    if (diff !== 0) {
      const diffPercent = Math.abs(Math.round((diff / prodResult) * 100))
      const color = diffPercent <= 1 ? c.yellow : c.red

      if (markdown) {
        console.log(
          fmtGHActionErr(
            localResult,
            prodResult,
            diff,
            diffPercent,
            name,
            color
          )
        )
      } else {
        fails.push(
          fmtCLIErr(localResult, prodResult, diff, diffPercent, name, color)
        )
      }
    }
  }
  if (!markdown) {
    const nbFails = fails.length
    fails.forEach((fail) => console.log(fail))
    console.log(`\n${c.green('OK')} ${nbTests - nbFails}/${nbTests}`)
    if (nbFails > 0) {
      console.log(`${c.red('FAIL')} ${nbFails}/${nbTests}`)
    }
  }
}

function formatValueInKgCO2e(value) {
  return c.yellow(Math.fround(value).toLocaleString('en-us')) + ' ' + kgCO2Str
}

function fmtCLIErr(localResult, prodResult, diff, diffPercent, name, color) {
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : ''
  const hd = color(diffPercent <= 1 ? '[WARN]' : '[FAIL]')
  return `${hd} ${name} [${color(sign + Math.abs(diff))} ${kgCO2Str}, ${color(
    sign + diffPercent
  )}%]: ${formatValueInKgCO2e(localResult)} != ${formatValueInKgCO2e(
    prodResult
  )}`
}

function fmtGHActionErr(localResult, prodResult, diff, diffPercent, name) {
  const color =
    diffPercent <= 1 ? 'sucess' : diffPercent > 5 ? 'critical' : 'important'
  const sign = diff > 0 ? '%2B' : '-'
  return `|![](https://img.shields.io/badge/${name.replaceAll(
    ' ',
    '%20'
  )}-${sign}${Math.round(diff).toLocaleString(
    'en-us'
  )}%20kgCO2e-${color}?style=flat-square) | **${localResult.toLocaleString(
    'en-us'
  )}** | ${prodResult.toLocaleString('en-us')} | ${
    diff > 0 ? '+' : '-'
  }${diffPercent}% |`
}
