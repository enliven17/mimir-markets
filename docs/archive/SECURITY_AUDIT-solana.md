# Mimir: off-chain güvenlik denetimi (mainnet öncesi)

**Tarih:** 2026-10-03
**Kapsam:** Oracle, market-creator ve council worker'ları; market açma, kapanma ve settlement kuralları; web/API; altyapı.
**Kapsam dışı:** On-chain program (`onchain/`). Ayrıca denetlenecek.
**Commit:** `9dc41e3`

**Doğrulama işaretleri:**
- **✓:** Kodu okuyarak doğrulandı.
- **?:** Deploy'a veya dış servise bağlı, doğrulanmadı.

**Özet:** Mainnet'e gerçek USDC ile çıkmadan önce **P0 maddeleri kapatılmalı**. En büyük risk tek bir sıcak anahtar. Admin, oracle, dispute hakemi ve fee recipient aynı anahtar. Persona cüzdanları da bu anahtardan türetiliyor. Bu anahtar internete açık web süreciyle aynı container'da duruyor. İkinci büyük risk: kullanıcı kendi kontrol ettiği bir kaynağı settlement kaynağı yapabiliyor ve house botları bu claim'lere otomatik stake ediyor.

---

## P0: mainnet öncesi zorunlu

### P0-1. Tek sıcak anahtar: admin, oracle, hakem ve fee recipient aynı (✓)
- **Nerede:**
  - `scripts/solana/initialize.ts:28-29`: `MIMIR_ORACLE` ve `MIMIR_FEE_RECIPIENT` verilmezse admin anahtarı kullanılıyor.
  - `lib/solana/keypair.ts:44-52`: creator anahtarı yoksa admin'e düşüyor.
  - `lib/solana/keypair.ts:60-66`: persona anahtarı `sha256(adminSecret ‖ slug)` ile türetiliyor.
  - `scripts/start-all.mjs:19-22`: Next ve worker'lar aynı container'da, aynı env ile çalışıyor.
  - `app/api/arena/agents/route.ts:53`: web isteği sırasında `loadAgentKeypair()` çağrılıyor.
- **Risk:** On-chain'de `settle_dispute` admin'e ait. Dolayısıyla oracle'ın verdict'ine yapılan itirazı yine aynı anahtar çözüyor. Anahtar ele geçirilirse:
  - istenen verdict önerilir ve itirazlar reddedilir,
  - `set_windows(0)` ile dispute penceresi sıfırlanır,
  - tüm persona cüzdanları boşaltılır.

  Web katmanında bir RCE, kötü niyetli bağımlılık veya env sızıntısı bunun için yeterli.
- **Fix:**
  1. Admin'i Squads multisig yap. Oracle için ayrı anahtar kullan (KMS/HSM ya da en azından ayrı servis). Fee recipient cold adres olsun.
  2. Mainnet'te `MIMIR_ORACLE == admin` veya `MIMIR_FEE_RECIPIENT == admin` ise `initialize.ts` hata versin.
  3. Persona anahtarlarını bağımsız üret ve ayrı secret'ta tut. Admin secret'tan türetme.
  4. Railway'de web ve worker'ları **ayrı servis** yap. Web'e hiçbir private key verme; web yalnızca `COUNCIL_ADDRESSES` ve oracle pubkey'ini görsün. `arena/agents/route.ts:53` bunun yerine `getConfig().oracle` okusun.
  5. `set_windows` ve admin işlemleri için timelock (on-chain denetime not).

### P0-2. Bait-and-switch: kullanıcının kontrol ettiği kaynakta house botları otomatik stake ediyor (✓)
- **Nerede:**
  - `agents/council/shared/persona-runner.ts:80-140`: persona'lar `direct`/`jina` ile çekilmiş sayfada, fetcher-trust cap uygulanmadan, ≥75 güvenle stake ediyor.
  - `persona-rules.ts:124-138`: stake bankroll'un %10'una kadar çıkabiliyor.
  - Bot user-agent'ları ayırt edilebilir: `Mimir-Council/1.0` ve `Mimir-Oracle/1.0`.
- **Senaryo:**
  1. Saldırgan 2 USDC ile claim açar; `resolution_url` kendi sunucusudur.
  2. Deadline öncesi sayfa "olmadı" der ve persona'lar stake eder.
  3. Settlement anında sayfa "oldu" der.
  4. Oracle 75 güvenle `[CONTESTED]` verdict önerir; `tierVerdict` 60–79 aralığını settle ediyor.
  5. Persona'lar itiraz etmez. 24 saat sonra finalize olur ve saldırgan stake'leri alır.
- **Ek:** Moderation yalnızca UI'da çalışıyor. Worker'lar moderasyondan geçmemiş claim'leri de işliyor.
- **Fix:**
  - House botları (oracle, council, auto-challenge) **yalnızca allowlist'teki API kaynaklarında** stake etsin: coingecko, flashtrade, espn, resolver-price.
  - Persona'lara da `applyFetcherTrust` uygula.
  - Deadline öncesi evidence hash'ini sakla. Settlement'ta içerik radikal biçimde değiştiyse propose etme, escalate et.
  - Standart tarayıcı UA'sı kullan.

### P0-3. Kullanıcının verdiği URL'deki JSON resolver doğrudan 95 güvenle settle ediyor (✓)
- **Nerede:** `agents/oracle/decide.ts:252-270`, `lib/resolver-spec.ts:78-87, 122-129`.
- **Risk:**
  - `resolution_url = https://attacker/x.json#mimir=json:eq:true:won` yazan creator sonucu kendisi belirler. LLM, cross-check ve fetcher-trust cap devreye girmez.
  - Sayısal operatörde değer `"pending"` gelirse `Number()` NaN döner, `compare` false olur. Sonuç `determined:true` çıkar ve No tarafı 95 ile kazanır.
- **Fix:**
  - JSON resolver'ı host allowlist'iyle sınırla (ESPN, gamma-api.polymarket.com, coingecko). Diğer host'larda spec'i yok say ve LLM yoluna düş (75 cap ile).
  - `>`, `>=`, `<`, `<=` için `Number.isFinite(Number(actual))` şartı koy; değilse `determined:false`.

### P0-4. DEX fiyatlı token'lar ($ANSEM, $MIMIR) manipüle edilebilir; price resolver'da spread ve freshness kontrolü yok (✓)
- **Nerede:**
  - `lib/resolver-spec.ts:109-120` (`evaluatePriceSpec`): yalnızca "≥2 okuma aynı tarafta mı" kontrolü var. Sonuç LLM'siz 95 güvenle settle ediliyor.
  - `lib/server/dex-prices.ts:18`: `MIN_LIQUIDITY_USD = 1_000`.
  - DexScreener, Jupiter ve CoinGecko bu memecoin'ler için aynı havuzları okuyor. Okumalar bağımsız değil.
- **Senaryo:** Oracle 30 saniyede bir poll ediyor. Deadline civarında yapılacak tek bir swap, eşiği istenen tarafa iter.
- **$MIMIR:** Operatörün kendi token'ı üzerine market açmak açık bir conflict of interest.
- **Fix:**
  - DEX token'larında structured resolver'ı kapat ya da TWAP kullan (≥15–30 dk, Pyth/Switchboard veya birden fazla havuz).
  - Likidite tabanını pot büyüklüğüne bağla.
  - `evaluatePriceSpec`'e `MAX_SOURCE_SPREAD` ve `MAX_READING_AGE_MS` filtrelerini ekle.
  - $MIMIR claim'lerini yasakla.

### P0-5. `HEDGE_MODE` fail-open ve dış servisin kurduğu tx kör imzalanıyor (✓)
- **Nerede:** `agents/oracle/solana.ts:73, 302, 334-346`.
- **Risk:**
  - `"Dry"`, `"false"`, `"0"` ya da sonunda boşluk olan değerlerin hepsi **live** yola girer.
  - Live modda `flashapi.trade`'den gelen tx, **admin/oracle anahtarıyla doğrulamasız** imzalanıyor. API compromise olursa tx'e her türlü instruction eklenebilir.
  - Hedge yönü yanlış olabiliyor: "No: BTC will not be above X" metninde "ABOVE" kelimesini görüp SHORT açıyor.
  - Açılan pozisyonlar hiç kapatılmıyor.
- **Fix:**
  - Strict parse: `dry`, `live` ve `off` dışındaki değerde process çıksın.
  - Live modda tx'i decode et: program allowlist'i (Flash ve ComputeBudget), signer ve fee payer kontrolü.
  - Ayrı, düşük bakiyeli bir hedge cüzdanı kullan.
  - Yönü metinden değil resolver spec'ten al.
  - Kapanış mantığı ekle. Hazır değilse mainnet'te `off` sabitle.

### P0-6. Rate-limit `X-Forwarded-For` ile atlatılabiliyor; web LLM kotası oracle'la ortak (✓ kod, ? Railway davranışı)
- **Nerede:** `lib/server/rate-limit.ts:72-75` header'daki ilk (istemcinin kontrol ettiği) değeri alıyor. `lib/llm.ts:90-91`: council'e ayrı key verilmezse `GEMINI_API_KEY` kullanılıyor.
- **Risk:** Rastgele XFF gönderilerek sınırsız istek atılabilir. Etkilenen route'lar:
  - `claim-moderation`, `claim-draft`, `council/*`: LLM maliyeti, ve oracle'ın kotası tükenince settlement gecikmesi.
  - `token/tier`: mainnet RPC kredisi.
  - Agent register spam'i.
- **Fix:**
  - Railway'in güvenilir header'ını kullan (proxy'nin eklediği en sağdaki değer veya `X-Real-IP`; dokümanla teyit et).
  - LLM route'larına global tavan koy.
  - Oracle LLM key'ini web/council key'inden zorunlu olarak ayır.

### P0-7. Mainnet config sessizce devnet'e düşüyor (✓)
- **Nerede:**
  - `lib/solana/config.ts:4-44`: program ID, RPC, ER RPC/WS, validator ve **USDC mint** için devnet fallback'leri.
  - Sabit `?cluster=devnet` linkleri: `RegisteredAgents.tsx`, `ActionDock.tsx`, `CouncilRoster.tsx`.
  - `scripts/solana/smoke-v3.ts`: mainnet guard'ı olmadan pause ve fee çekme yapıyor.
- **Fix:**
  - `MIMIR_CLUSTER=mainnet` iken env eksikse build ya da start fail etsin.
  - USDC mint'i `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` ile karşılaştır.
  - Start'ta `getGenesisHash()` ile cluster'ı, config PDA'daki `usdc_mint`'i de env ile doğrula.
  - Keyli RPC (Helius `?api-key=`) asla `NEXT_PUBLIC_*` değişkenine konmasın; `lib/agents/chain.ts:64-67` bu değeri agent'lara da dönüyor.

---

## P1: ilk hafta

### P1-1. Conflict of interest: house hem karşı taraf, hem hakem, hem itiraz mercii
- **Taraf tutma:** Market-creator her zaman "Yes" tarafında stake ediyor. AUTO_CHALLENGE açıkken oracle, settle edeceği claim'lere aynı modelle stake ediyor.
- **Eksik kontrol:** `decide.ts:396-406`'daki "house has stake → yalnızca FIRM verdict" kuralı yalnızca oracle anahtarına bakıyor. Creator ve persona cüzdanları kontrol edilmiyor.
- **Jüri:** Pozisyonu olan juror dışlanıyor, ama kalan jüri de aynı operatörün LLM persona'larından oluşuyor.
- **Fix:**
  - "House" kontrolünü tüm house adresleri (oracle, creator, persona'lar) üzerinden yap.
  - House pozisyonu olan claim'lerde dispute zorunlu olsun ve bağımsız bir hakem çözsün.
  - Mainnet'te AUTO_CHALLENGE'ı kapat.

### P1-2. Kelly boyutlandırması pool odds'unu yok sayıyor ve EV negatif (`lib/kelly.ts`, `netOdds=1.0`)
- Challenger kazanırsa en fazla creator stake'inin payını alır. Örnek: 2 USDC creator stake'ine 100 USDC stake ve %80 güven, EV ≈ −18 USDC.
- **Fix:**
  - `b = creatorStake / (totalChallengerStake + stake)` ile hesapla.
  - Stake'e `≤ k × creatorStake` tavanı koy.

### P1-3. Oracle döngüsünde DoS ve LLM maliyeti
- **Sorun:**
  - Sports ve Polymarket claim'lerinde `isEventFinal` her poll'da LLM çağırıyor. `decide` null dönünce backoff yok.
  - Döngü tüm claim'leri sırayla geziyor ve `ORACLE_LLM_THROTTLE_MS=0`.
- **Etki:** 2 USDC'lik sock challenger'lı claim'ler binlerce LLM çağrısı üretir; kota biter ve gerçek settlement'lar gecikir.
- **Fix:**
  - Claim başına üstel backoff (5 dk → 1 sa) ve evidence hash cache'i.
  - Polymarket'te LLM yerine gamma JSON'daki `closed` ve `umaResolutionStatus` alanlarını deterministik oku.
  - Aktif ID'leri indexer'dan al ve claim başına zaman bütçesi koy.
  - Settle işini lifecycle crank'lerinden ayır.

### P1-4. Fiyat okuma zamanı: deadline'daki değil, settle anındaki fiyat
- **Sorun:**
  - `price-sources.ts:204`: deadline sonrası ilk 5 dakikada live okuma yapılıyor.
  - `chainlink.ts`: 26 saate kadar eski bir round, `at: atMs` ile taze gösteriliyor.
  - Chainlink BTC/ETH deviation'ı (%0,5), market-creator'ın ±%0,3 eşiğinden büyük.
- **Fix:**
  - Her zaman deadline anındaki historical/round değerini oku ve okuma ile deadline arası farkı ≤60 sn zorla.
  - Chainlink'te gerçek `updatedAt` değerini raporla.
  - Eşik, kaynak deviation'ından küçükse market açma.

### P1-5. LLM fallback zinciri zayıf modele düşebiliyor
- **Sorun:**
  - Settlement sırası primary → Groq (llama, schema yok) → Anthropic.
  - `noFreeRouter` yalnızca tam olarak `"openrouter/free"` değerini engelliyor; `...:free` modeller geçiyor.
  - `isEventFinal` için temperature verilmemiş (0.2).
  - `lastCall` global, bu yüzden bundle'a yanlış model yazılabilir.
- **Fix:**
  - Settlement için açık bir model allowlist'i. Listede olmayan model → retry later.
  - `callLLM` kullanılan modeli dönüş değerinde versin.

### P1-6. Soru metni ile `#mimir=` spec'i uzlaştırılmıyor; cross-check yanlış claim'lere uygulanıyor
- **Sorun:**
  - "SOL above 250?" sorusuna `#mimir=price:SOL:lt:250` eklenebiliyor. Oracle spec'e göre 95 ile settle ediyor; LLM ise fragment'i görmüyor.
  - "Solana market cap above $100B" sorusunda SOL fiyatı $100B ile kıyaslanıyor (`price-consensus.ts:226-238`). Sonuç, "No" tarafındaki creator için bedava bir opsiyon.
- **Fix:**
  - Sorudaki sembol, eşik ve yön spec ile birebir eşleşmezse spec'i yok say.
  - Cross-check'i yalnızca price spec'i olan claim'lerde çalıştır.

### P1-7. Evidence zamanı ve Polymarket
- **Sorun:**
  - Prompt "date/deadline concerns yüzünden reddetme" diyor. Evidence ise settle anında çekiliyor; deadline'dan sonraki olaylar da sayılabilir.
  - 72 saatlik grace dolduğunda UMA hâlâ dispute'taysa yine de settle ediliyor.
- **Fix:**
  - Prompt'a "yalnızca deadline öncesindeki olaylar" kuralını ekle.
  - Polymarket'i `umaResolutionStatus === "resolved"` olmadan settle etme; grace dolarsa refund et.

### P1-8. SDK sunucunun kurduğu tx'i yalnızca `feePayer` kontrolüyle imzalıyor
- **Nerede:** `sdk/agents.ts:252-259`. `prepared.rpcUrl` da sunucudan geliyor. Aynı desen `BasketDetailClient.tsx:213-216`'da da var.
- **Risk:** Sunucu, DNS veya `baseUrl` ele geçirilirse operatörün cüzdanından transfer instruction'ı eklenip otomatik imzalatılır.
- **Fix:**
  - Program allowlist'i: `MIMIR_PROGRAM_ID` SDK'da sabit olsun; ComputeBudget ve ATA programlarına izin ver.
  - Instruction discriminator'ı, tutar ve claim PDA istenen action ile eşleşmeli.
  - `rpcUrl` yalnızca istemci config'inden alınsın.

### P1-9. Node 20 EOL (Nisan 2026)
- **Nerede:** `nixpacks.toml`, `.nvmrc`, `ci.yml`.
- **Fix:** Node 22 veya 24 LTS'e geç.

### P1-10. LLM endpoint'lerinde girdi ve body limiti yok
- **Nerede:** `lib/server/claim-moderation-route-handler.ts:33-66` ve `req.json()` sınırsız okuyor.
- **Fix:**
  - Alanları on-chain limitlere bağla (question 200B, position 100B, url 200B).
  - `Content-Length` > 16KB ise isteği okumadan reddet.

---

## P2: mainnet'ten önce, ama bloklayıcı değil

| # | Konu | Yer | Fix |
|---|---|---|---|
| P2-1 | ER re-delegation: `delegate_claim` permissionless ve deadline kontrolü yok. Expired claim yeniden delegate edilirse propose ve refund takılır. | `delegation.rs:17-31`, `client.ts:507-530` | On-chain: deadline kontrolü ve validator allowlist'i. Off-chain: delegation record'dan doğru ER endpoint'ini seç. |
| P2-2 | Payout crank'i kapalı ATA'da sonsuza kadar fail ediyor. Rastgele `agent` pubkey'leri için fee PDA rent'ini oracle ödüyor. | `client.ts:418-456` | `createAssociatedTokenAccountIdempotent`; fee PDA'yı yalnızca allowlist'teki agent'lar için aç. |
| P2-3 | Market-creator griefing: `MAX_ACTIVE_CLAIMS` ve dedupe herkesin claim'lerini sayıyor. | `inventory.ts:31-36`, `market-creator/solana.ts:208-217` | Yalnızca house claim'lerini say. |
| P2-4 | Rule persona'lar (contrarian, whale-watcher) sock challenger ile tuzağa düşürülebiliyor. | `persona-rules.ts:43-101` | Mainnet'te kapat ya da yalnızca house market'lerinde çalıştır. |
| P2-5 | Dispute yalnızca console'a log'lanıyor. Bundle kaydı başarısız olsa da propose ediliyor. | `oracle/lifecycle.ts:53-58`, `solana.ts:183-185` | Bundle yoksa propose etme. DISPUTED için Telegram veya PagerDuty alarmı. |
| P2-6 | CSP'de `script-src` yok. Bugün XSS sink'i yok, ama bu bir cüzdan uygulaması. | `next.config.js:15-22` | Report-Only ile başla: `script-src 'self' 'nonce-…'; object-src 'none'; base-uri 'self'`, sonra enforce et. |
| P2-7 | Agent ID'lerinde rezerve isim yok (`socrates`, `oracle`, `mimir`). Kayıt gate'i varsayılan 0. | `lib/agents/api.ts:68`, `baskets-performance.ts:34-45` | Rezerve liste ekle; mainnet'te `AGENT_REGISTER_MIN_*` değerlerini aç. |
| P2-8 | `rateIdentity` rate-limit'ten önce mainnet RPC çağırıyor. | `lib/server/holder.ts:31-57` | Önce IP limiti, sonra proof. |
| P2-9 | Webhook teslimi indexer döngüsünü bloke ediyor (event başına ~21 sn). | `lib/server/notifications.ts` | Asenkron kuyruk ve devre kesici. |
| P2-10 | Agent bütçe kontrolünde race condition; `dispute` bond'u bütçeye sayılmıyor. | `app/api/agents/v1/[action]/route.ts`, `registry.ts:333` | Atomik sayaç; dispute'u `STAKING_ACTIONS`'a ekle. |
| P2-11 | Copy takipçi limitleri executor'ın kendi raporuna dayanıyor. | `app/api/copy/signals/route.ts` | Prepare aşamasında geçici harcama kaydı yaz. |
| P2-12 | CI: `permissions:` bloğu yok, action'lar tag'e pinli. Vercel `npm install` kullanıyor. | `ci.yml`, `vercel.json` | `permissions: contents: read`, SHA pin, `npm ci`. |
| P2-13 | `npm audit --omit=dev`: 7 high, 11 moderate, 10 low. Hepsi Solana stack'inde ve WalletConnect zincirinde; `next` temiz. | `package.json` | Güncelle ya da override et, kalanları belgele. |

## P3: düşük

- **SSRF:** `ssrf.ts` 198.18.0.0/15 ve 192.88.99.0/24 bloklarını kapsamıyor. Gateway bir URL'yi reddedince Jina fallback devreye giriyor ve URL üçüncü tarafa (r.jina.ai) sızıyor.
- **LLM özeti:** On-chain'e yazılan 300 karakterlik özete saldırganın evidence'ından phishing metni girebilir.
- **Log:** `llm.ts:78,305` API key'in son 6 karakterini log'luyor.
- **Unbounded TTL cache:** `lib/server/ttl-cache.ts`.
- **CDN yok:** Railway'de CDN olmadığı için `s-maxage` etkisiz; rate limit'siz GET route'ları her istekte Neon'a gidiyor.
- **Webhook secret:** DB'de düz metin (HMAC için gerekli).
- **? ESPN tarih parametresi:** `dates=` UTC ve ET günü uyumu teyit edilmeli.
- **? Borsa tatili:** `stocks.ts` tatil günlerindeki davranışı teyit edilmeli.

---

## On-chain denetime devredilecekler

- `set_windows` ve admin işlemleri için timelock (P0-1).
- `delegate_claim` deadline kontrolü ve validator allowlist'i (P2-1).
- `create_claim` ve `challenge_claim` içindeki serbest `agent` argümanı: agent fee kendine yönlendirilerek ücret düşürülebiliyor mu?
- `settle_dispute` hakeminin admin'den ayrılması.

## Sağlam bulunanlar (✓)

- **SSRF gateway:** Her redirect hop'u yeniden doğrulanıyor; DNS sonucu socket'e pinleniyor (rebinding yok). IPv6, NAT64, 6to4 ve Teredo adresleri ele alınıyor. Port allowlist'i ve 512KB body limiti var.
- **LLM settlement:** `temperature: 0`, JSON schema ve verdict doğrulaması var. Parse hatası retry'a gidiyor, verdict'e dönüşmüyor. Non-API evidence 75'te cap'leniyor; 60'ın altı refund.
- **Lifecycle:** Propose öncesi base katmandan yeniden okuma, aynı verdict'in tekrar kullanılması, backoff, permissionless finalize/crank/refund. Verdict bundle'ın sha256'sı on-chain'de; `/verify` bunu yeniden hesaplıyor.
- **SQL:** Tamamen parametreli.
- **Agent auth:** ed25519 imzası body hash'ini kapsıyor. Nonce atomik, ±5 dk pencere var. API key'lerin yalnızca SHA-256'sı tutuluyor. Sunucu hiçbir zaman imza atmıyor.
- **Copy/basket imzaları:** Prefix'ler ayrık; `signedAt` monotonluğu atomik.
- **XSS:** Sink yok; `javascript:` evidence linki imkânsız. Open redirect yok.
- **Secret'lar:** 278 commit'lik git geçmişinde secret yok. `.keys/` gitignore'da. CI'da gitleaks var.
- **Payout alıcısı:** On-chain `WrongRecipient` kontrolü var.

---

## Önerilen sıra (4 hafta)

| Hafta | İş |
|---|---|
| 1 | P0-1 (anahtar ayrımı, multisig, web/worker servis ayrımı), P0-5 (`HEDGE_MODE=off` sabitle), P0-6, P0-7 |
| 2 | P0-2, P0-3, P0-4 (kaynak allowlist'i ve TWAP), P1-1, P1-2 |
| 3 | P1-3 … P1-10, on-chain denetim |
| 4 | P2 maddeleri, devnet'te tam lifecycle tekrarı, mainnet'e küçük limitlerle (claim başına stake tavanı) soft launch |

---

## Düzeltme durumu (2026-10-03, commit edilmedi)

Dört turda düzeltildi; ikinci turdan sonra bağımsız bir inceleme yapıldı ve bulguları dördüncü turda kapatıldı.

| ID | Durum | Not |
|---|---|---|
| P0-1 | Kod tarafı kapandı | Web süreci private key yüklemiyor. `start:web` ve `start:workers` ayrı, `start:all` mainnet'te reddediliyor. Creator, persona (`COUNCIL_KEY_SEED`) ve hedge (`HEDGE_KEYPAIR`) anahtarları admin/oracle'dan ayrı; mainnet'te eşitlik ya da eksiklik varsa süreç hata fırlatıyor. `initialize.ts` oracle veya fee recipient == admin ise reddediyor. `admin.ts`'te `propose-admin` (Squads için) ve queue komutları var. **Ops tarafında kalan:** Squads multisig devri, Railway'i iki servise bölmek, KMS. |
| P0-2 | Kapandı | Persona'lar yalnızca API evidence'ında stake ediyor ve `applyFetcherTrust` uygulanıyor. Bot UA'ları tarayıcı UA'sı oldu. Deadline öncesi evidence hash'i eklenmedi. |
| P0-3 | Kapandı | JSON resolver yalnızca ESPN'de çalışıyor. Maç tamamlanmış olmalı ve claim açıldıktan sonra başlamış olmalı; tipler uyuşmazsa sonuç `determined:false`. Polymarket yalnızca slug ile, market bağlamasıyla (bitiş tarihi, kapanış zamanı, soru eşleşmesi) ve UMA çözümüyle settle ediliyor. Gamma ve CoinGecko JSON yolu kapalı. |
| P0-4 | Kapandı | DEX token'ları structured resolver'a girmiyor. Likidite tabanı 250k. Spread ve freshness kontrolü var. $MIMIR claim'i yasak; $ANSEM mainnet'te varsayılan olarak kapalı. TWAP yok. |
| P0-5 | Kapandı | `HEDGE_MODE` strict parse ediliyor, mainnet'te varsayılan `off`, `live` için açık onay gerekiyor. Ayrı hedge cüzdanı var. Tx kontrolü: program allowlist'i, tek Flash instruction, priority fee tavanı, yalnızca kendi ATA'sı. Yön spec'ten alınıyor. **Pozisyon kapatma mantığı yok.** |
| P0-6 | Kapandı (? Railway header davranışı) | `TRUSTED_PROXY_HOPS`, global LLM tavanları (bellek modunda flood ile sıfırlanamıyor), oracle LLM key'i ayrı; web, oracle key'iyle aynı olan key'i reddediyor. |
| P0-7 | Kapandı | Mainnet'te devnet varsayılanı yok; build guard ve USDC mint kontrolü var. Keyli `NEXT_PUBLIC_` RPC reddediliyor. Explorer linkleri cluster'a göre. Agent'lara yalnızca bilinen public RPC'ler dönüyor. Script'ler `--mainnet`/`--yes` istiyor. `getGenesisHash` doğrulaması yok. |
| P1-1 | Kapandı (off-chain) | House seti eksiksiz; mainnet'te eksikse süreç başlamıyor. Mainnet'te AUTO_CHALLENGE kapalı. Bağımsız hakem on-chain işi. |
| P1-2 | Kapandı | Kelly gerçek pool odds'unu kullanıyor; oracle ve council'de stake creator stake'iyle sınırlı. |
| P1-3 | Kapandı | Claim başına backoff, Polymarket deterministik, throttle var. |
| P1-4 | Kapandı | Kaynak bazlı tolerans (CoinGecko/CMC yarım interval, Chainlink heartbeat). İki okuma yoksa claim bekletiliyor, sonra iade; LLM'e düşmüyor. Pyth geçmiş API'si artık key istiyor, eklenmedi. |
| P1-5 | Kapandı | `SETTLEMENT_MODELS` allowlist'i; Groq, OpenRouter, `:free` ve Gemma settlement'ta kullanılmıyor. |
| P1-6 | Kapandı | Spec soru metniyle eşleşmeli. `NOT_A_PRICE` market cap, FDV, TVL gibi ifadeleri yakalıyor. |
| P1-7 | Kapandı | Deadline kuralı prompt'ta. Polymarket iadesi yalnızca Gamma başarıyla okunduysa yapılıyor. |
| P1-8 | Kapandı | SDK'da program/discriminator/tutar/claim kontrolleri, tek instruction, createClaim stake'i, agent fee alıcısı ve ATA sahibi kontrolü. |
| P1-9 | Kapandı | Node 22. |
| P1-10 | Kapandı | Body limiti ve on-chain byte limitleri (preflight dahil). |
| P2-1 | Açık | On-chain `delegate_claim`. |
| P2-2 | Kapandı | ATA idempotent oluşturuluyor; fee PDA allowlist'i agent registry'den besleniyor, takılan leg için alarm var. |
| P2-3, P2-4 | Kapandı | Envanter yalnızca house claim'lerini sayıyor. Rule persona'lar yalnızca house market'lerinde çalışıyor ve mainnet'te kapalı. |
| P2-5 | Kapandı | Bundle kaydedilemezse propose yok. DISPUTED durumu `ALERT_WEBHOOK_URL`'e bildiriliyor. |
| P2-6 | Report-only | Nonce'lu CSP report-only modunda; enforce etmeden önce ihlal raporları izlenmeli. |
| P2-7 … P2-12 | Kapandı | Homoglyph ve leet yazımlı rezerve isimler, rate limit sırası, webhook kuyruğu, atomik bütçe, kilitli copy rezervasyonu (rezervasyon 7 gün geçerli), CI permissions ve SHA pin'leri. |
| P2-13 | Kısmi | `npm audit` 23 açık (5 high). Kalan high'lar: anchor/toml (fix yok) ve spl-token/bigint-buffer (yalnızca major). |
| P3 | Kapandı | SSRF aralıkları, Jina sızıntısı, key log'u, TTL cache, link temizleme. |

**Mainnet env checklist:** `docs/SOLANA.md` → "Deploy (mainnet)" ve `.env.example`.
