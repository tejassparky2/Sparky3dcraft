/**
 * Idempotent store bootstrap for Sparky 3D Craft Co.
 *
 *   npx medusa exec ./src/scripts/setup-store.ts
 *
 * Reads merchant-supplied settings from $SPARKY_STORE_CONFIG (default
 * ./store.config.json; see store.config.example.json). Safe to re-run: every
 * entity is looked up by a stable name before it is created, and values the
 * merchant may have changed in Medusa Admin afterwards (shipping prices,
 * tax rates) are NOT overwritten on re-runs.
 *
 * Nothing here invents business data: shipping prices, free-shipping
 * thresholds and tax rates come only from the config file.
 */
import fs from "node:fs"
import path from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

export type StoreConfig = {
  store_name: string
  currency_code: string // "inr"
  country_code: string // "in"
  prices_include_tax: boolean
  sales_channel_name: string
  region_name: string
  tax?: { default_rate?: { name: string; code: string; rate: number } | null }
  stock_location: {
    name: string
    address: {
      address_1?: string
      city?: string
      province?: string
      postal_code?: string
      country_code: string
    }
  }
  shipping_options: {
    code: string
    name: string
    description?: string
    amount: number
    free_shipping_threshold?: number | null
  }[]
}

export function loadStoreConfig(file?: string): StoreConfig {
  const p = path.resolve(file ?? process.env.SPARKY_STORE_CONFIG ?? "store.config.json")
  if (!fs.existsSync(p)) {
    throw new Error(
      `Store config not found at ${p}. Copy store.config.example.json and fill in merchant values.`
    )
  }
  const cfg = JSON.parse(fs.readFileSync(p, "utf8")) as StoreConfig
  const errs: string[] = []
  if (!cfg.store_name) errs.push("store_name")
  if (!/^[a-z]{3}$/.test(cfg.currency_code ?? "")) errs.push("currency_code")
  if (!/^[a-z]{2}$/.test(cfg.country_code ?? "")) errs.push("country_code")
  if (!Array.isArray(cfg.shipping_options) || !cfg.shipping_options.length) {
    errs.push("shipping_options (at least one, with merchant-approved amount)")
  }
  for (const o of cfg.shipping_options ?? []) {
    if (!o.code || !o.name || typeof o.amount !== "number" || o.amount < 0) {
      errs.push(`shipping_options[${o.code ?? "?"}]`)
    }
  }
  if (errs.length) throw new Error(`Invalid store config ${p}: ${errs.join(", ")}`)
  return cfg
}

export default async function setupStore({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const storeModule = container.resolve(Modules.STORE)
  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  const regionModule = container.resolve(Modules.REGION)
  const taxModule = container.resolve(Modules.TAX)
  const stockLocationModule = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  const paymentModule = container.resolve(Modules.PAYMENT)
  const apiKeyModule = container.resolve(Modules.API_KEY)

  const cfg = loadStoreConfig()
  const isProd = process.env.NODE_ENV === "production"
  const log = (m: string) => logger.info(`[setup-store] ${m}`)

  // 1. Store + currency --------------------------------------------------------
  const [store] = await storeModule.listStores()
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        name: cfg.store_name,
        supported_currencies: [
          {
            currency_code: cfg.currency_code,
            is_default: true,
            is_tax_inclusive: cfg.prices_include_tax,
          },
        ],
      },
    },
  })
  log(`store "${cfg.store_name}" currency=${cfg.currency_code} tax_inclusive=${cfg.prices_include_tax}`)

  // 2. Sales channel -----------------------------------------------------------
  let [channel] = await salesChannelModule.listSalesChannels({ name: cfg.sales_channel_name })
  if (!channel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: cfg.sales_channel_name, description: "Online storefront" }] },
    })
    channel = result[0]
    log(`created sales channel ${channel.id}`)
  }
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { default_sales_channel_id: channel.id } },
  })

  // 3. Publishable API key -------------------------------------------------------
  let [pk] = await apiKeyModule.listApiKeys({ title: cfg.sales_channel_name, type: "publishable" })
  if (!pk) {
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: cfg.sales_channel_name, type: "publishable", created_by: "" }] },
    })
    pk = result[0] as any
    log(`created publishable key ${pk.id}`)
  }
  const { data: pkLinks } = await query.graph({
    entity: "api_key",
    fields: ["id", "sales_channels.id"],
    filters: { id: pk.id },
  })
  if (!(pkLinks[0] as any)?.sales_channels?.some((s: any) => s.id === channel.id)) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: pk.id, add: [channel.id] } })
  }
  const keyFile = process.env.SPARKY_PUBLISHABLE_KEY_FILE
  if (keyFile) {
    fs.writeFileSync(keyFile, pk.token + "\n", { mode: 0o600 })
    log(`publishable key written to ${keyFile}`)
  }

  // 4. Region ---------------------------------------------------------------------
  const providers = await paymentModule.listPaymentProviders({ is_enabled: true })
  let providerIds = providers.map((p) => p.id)
  // Medusa 2.21.1 never disables a provider that was removed from medusa-config
  // (registerProvidersInDb only lists still-configured ids), so a provider that
  // was configured once stays is_enabled forever. Offer only providers that are
  // configured in THIS process (ids are pp_<identifier>_<config id>).
  const configModule = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any
  const configuredIds: string[] = ((configModule?.modules?.[Modules.PAYMENT]?.options?.providers ?? []) as any[]).map(
    (p) => String(p.id)
  )
  const stale = providerIds.filter((id) => id !== "pp_system_default" && !configuredIds.some((c) => id.endsWith(`_${c}`)))
  if (stale.length) log(`ignoring payment providers no longer configured: ${stale.join(", ")}`)
  providerIds = providerIds.filter((id) => !stale.includes(id))
  if (isProd || process.env.SPARKY_DISABLE_SYSTEM_PAYMENT === "true") {
    // pp_system_default authorizes without collecting money — never offer it
    // to real customers.
    providerIds = providerIds.filter((id) => id !== "pp_system_default")
  }
  if (!providerIds.length) {
    logger.warn(
      "[setup-store] no real payment provider is enabled (configure Razorpay and/or COD_ENABLED=true); checkout will not be possible"
    )
  }
  let [region] = await regionModule.listRegions({ name: cfg.region_name })
  if (!region) {
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: cfg.region_name,
            currency_code: cfg.currency_code,
            countries: [cfg.country_code],
            payment_providers: providerIds,
            is_tax_inclusive: cfg.prices_include_tax,
            automatic_taxes: true,
          },
        ],
      },
    })
    region = result[0]
    log(`created region ${region.id}`)
  } else {
    await updateRegionsWorkflow(container).run({
      input: {
        selector: { id: region.id },
        update: { payment_providers: providerIds, is_tax_inclusive: cfg.prices_include_tax },
      },
    })
  }
  log(`region "${cfg.region_name}" payment providers: ${providerIds.join(", ") || "(none)"}`)

  // 5. Tax region -------------------------------------------------------------------
  const [taxRegion] = await taxModule.listTaxRegions({ country_code: cfg.country_code, parent_id: { $eq: null } } as any)
  if (!taxRegion) {
    await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: cfg.country_code,
          provider_id: "tp_system",
          ...(cfg.tax?.default_rate ? { default_tax_rate: cfg.tax.default_rate } : {}),
        },
      ],
    })
    log(
      `created tax region ${cfg.country_code}` +
        (cfg.tax?.default_rate ? ` with default rate ${cfg.tax.default_rate.rate}%` : " (no default rate — merchant must confirm GST setup)")
    )
  }

  // 6. Stock location ----------------------------------------------------------------
  let [location] = await stockLocationModule.listStockLocations({ name: cfg.stock_location.name })
  if (!location) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: cfg.stock_location.name,
            address: {
              address_1: cfg.stock_location.address.address_1 ?? "",
              city: cfg.stock_location.address.city,
              province: cfg.stock_location.address.province,
              postal_code: cfg.stock_location.address.postal_code,
              country_code: cfg.stock_location.address.country_code,
            },
          },
        ],
      },
    })
    location = result[0]
    log(`created stock location ${location.id}`)
  }
  await updateStoresWorkflow(container).run({
    input: { selector: { id: store.id }, update: { default_location_id: location.id } },
  })
  const { data: locData } = await query.graph({
    entity: "stock_location",
    fields: ["id", "fulfillment_providers.id", "fulfillment_sets.id", "fulfillment_sets.name", "sales_channels.id"],
    filters: { id: location.id },
  })
  const loc = locData[0] as any
  if (!loc.fulfillment_providers?.some((p: any) => p.id === "manual_manual")) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    })
  }
  if (!loc.sales_channels?.some((s: any) => s.id === channel.id)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: [channel.id] },
    })
  }

  // 7. Shipping profile + fulfillment set --------------------------------------------
  let [profile] = await fulfillmentModule.listShippingProfiles({ type: "default" })
  if (!profile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    })
    profile = result[0]
  }
  const fsName = `${cfg.stock_location.name} shipping`
  let [fset] = await fulfillmentModule.listFulfillmentSets({ name: fsName }, { relations: ["service_zones"] })
  if (!fset) {
    fset = await fulfillmentModule.createFulfillmentSets({
      name: fsName,
      type: "shipping",
      service_zones: [
        { name: cfg.region_name, geo_zones: [{ type: "country", country_code: cfg.country_code }] },
      ],
    })
    fset = (await fulfillmentModule.listFulfillmentSets({ id: fset.id }, { relations: ["service_zones"] }))[0]
    log(`created fulfillment set ${fset.id}`)
  }
  if (!loc.fulfillment_sets?.some((f: any) => f.id === fset.id)) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fset.id },
    })
  }
  const zone = fset.service_zones[0]

  // 8. Shipping options (created once; afterwards merchant-managed in Admin) --------
  const existing = await fulfillmentModule.listShippingOptions({ service_zone: { id: zone.id } } as any)
  for (const o of cfg.shipping_options) {
    if (existing.some((e) => e.name === o.name)) {
      log(`shipping option "${o.name}" exists — leaving merchant-managed values untouched`)
      continue
    }
    const prices: any[] = [{ region_id: region.id, amount: o.amount }]
    if (typeof o.free_shipping_threshold === "number" && o.free_shipping_threshold > 0) {
      prices.push({
        region_id: region.id,
        amount: 0,
        rules: [{ attribute: "item_total", operator: "gte", value: o.free_shipping_threshold }],
      })
    }
    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: o.name,
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: zone.id,
          shipping_profile_id: profile.id,
          type: { label: o.name, description: o.description ?? "", code: o.code },
          prices,
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    log(
      `created shipping option "${o.name}" ${o.amount} ${cfg.currency_code}` +
        (o.free_shipping_threshold ? `, free when items total >= ${o.free_shipping_threshold}` : "")
    )
  }

  log("done")
}
