const fs = require('fs')
const AWS = require('aws-sdk')
const path = require('path')
const UUID = require('uuid/v4')
const yaml = require('js-yaml')
const chromium = require('chrome-aws-lambda')
const tabletojson = require('tabletojson')
const { addExtra } = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

const docClient = new AWS.DynamoDB.DocumentClient({ apiVersion: '2012-08-10' })
const priceData = yaml.safeLoad(fs.readFileSync(path.join(__dirname, './price-data.yml')))
const toSearch = Object
  .values(priceData)
  .filter(d => d.search)

const weightRegex = /\d+(g|kg|ml| litres)/
const toPut = {
  'FOODfiles|2018V1|Q9': true,
  'FOODfiles|2018V1|L68': true
}

exports.handler = async (event, context) => {
  let result = null
  let browser = null
	const puppeteer = addExtra(chromium.puppeteer)
	puppeteer.use(StealthPlugin())

  try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: false,
      })
  
      let page = await browser.newPage()
      await page.goto(event.url || 'https://shop.countdown.co.nz/')
			await page.waitFor(4000)
      const now = new Date().toISOString()

      for (let i = 0; i < toSearch.length; i++) {
        const d = toSearch[i]
        const { search, foodId } = d

        if (toPut[foodId] || true) {
          await page.type('#search', search, { delay: 100 })
          await page.click('#searchIcon')

          // mimic human users
          await page.waitFor(5000 + parseInt(Math.random() * 4000))
          const products = await page.$$('product-stamp')

          // assume the first product listed in search results is the one we want
          const firstProduct = products[0]
          if (firstProduct) {
            const productSize = await firstProduct.$$eval('span.product-size', nodes => nodes.map(node => node.innerText))
            const productPrice = await firstProduct.$$eval('h3.presentPrice', nodes => nodes.map(node => node.getAttribute('aria-label')))
            const weight = productSize[0]
            const price = productPrice[0].replace('$', '')
            const put = {
              TableName: `${process.env.PRICE_TABLE}-${process.env.ENV}`,
              Item: {
                id:             UUID(),
                name:           d.name,
                dataSource:     'countdown',
                date:           now,
                foodId:         `FOODfiles|2018V1|${foodId}`,
                location:       'nz',
                cents:          parseFloat(price) * 100,
                currency:       'nzd',
                to_edible:      d.to_edible,
                max_servings:   d.max_servings,
                serving:        d.serving,
                unit_single:    d.unit_single || 'g',
                unit_plural:    d.unit_plural || 'g',
                meat:           d.meat,
                red_meat:       d.red_meat,
                fish:           d.fish,
                mollusc:        d.mollusc,
                crustacean:     d.crustacean,
                pork:           d.pork,
                dairy:          d.dairy,
                legume:         d.legume,
                grain:          d.grain,
                gluten:         d.grain,
                seed_oil:       d.seed_oil
              }
            }

            // standardise weights to g/ml
            const p = weight.match(weightRegex)
            if (p) {
              const unit = p[1]
              if (unit === 'g' || unit === 'ml') {
                put.Item.weight = parseInt(p[0])
              } else if (unit === 'kg' || unit === 'litre' || unit === "litres") {
                put.Item.weight = parseInt(p[0]) * 1000
              }

              console.log({ put })
              await  docClient.put(put).promise()
            }
          } else {
            console.log(search, ' failed')
          }
        }
      }

			await browser.close()
			browser = null
    } catch (error) {
      console.log({ error })
      return context.fail(error)
    } finally {
      if (browser !== null) {
        await browser.close()
      }
    }

  return context.succeed(result)
}


