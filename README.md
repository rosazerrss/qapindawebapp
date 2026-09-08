# Qapında

Azərbaycan üçün yemək çatdırılması marketplace-i. Restoranlar **öz kuryeri** ilə
çatdırır — platformanın kuryer parkı yoxdur. Ödəniş V1-də **qapıda nağd** və
**qapıda kartla**; onlayn ödənişin yeri verilənlər modelində hazır saxlanılıb.

---

## Nə hazırdır

| Hissə | Vəziyyət |
|---|---|
| Domen təbəqəsi (qiymət, kupon, komissiya, sifariş vəziyyət maşını) | ✅ 84 test keçir |
| Firestore təhlükəsizlik qaydaları + indekslər | ✅ |
| Cloud Functions (37 funksiya) | ✅ |
| Müştəri tərəfi (qonaq rejimi, menyu, səbət, sifariş izləmə) | ✅ |
| Restoran paneli (sifariş növbəsi, menyu redaktoru, hesabat, işçilər) | ✅ |
| Admin panel (təsdiq, komissiya, kuponlar, maliyyə, jurnal) | ✅ |
| Şəhər/rayon sistemi (74 yer, avtomatik təyin) | ✅ |
| Seçilmişlər (ürək) | ✅ |
| Xəritədə çatdırılma zonası (OpenStreetMap) | ✅ |
| Google ilə giriş | ✅ |
| E-poçt təsdiqi (6 rəqəmli kod) | ⚙️ Resend açarı lazımdır — aşağıda |
| Hüquqi mətnlər | ⚠️ Şablon — hüquqşünas yoxlamalıdır |
| Şəkil yükləmə (logo/menyu foto) | ⏳ Storage qaydaları hazırdır, UI hələ yoxdur |

---

## 1. Firebase layihəsi

BestCup-dan **ayrı** layihə açın.

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → ad: `qapinda`
2. **Blaze (pay as you go)** planına keçin — Cloud Functions üçün məcburidir.
3. **Build → Authentication → Get started → Phone** metodunu aktivləşdirin.
4. **Build → Firestore Database → Create database**
   - Rejim: **Production mode**
   - Region: **`europe-west1`** (Belçika)

   > ⚠️ Region sonradan dəyişmir. Səhv seçsəniz bazanı silib yenidən yaratmaq
   > lazım gəlir və ID təxminən 5 dəqiqə rezerv qalır.
5. **Build → Storage → Get started** → eyni region.
6. **Project settings → General → Your apps → Web (`</>`)** → tətbiq əlavə edin
   və `firebaseConfig` dəyərlərini kopyalayın.

### Mühit faylı

```bash
cp .env.example .env.local
```

`.env.local` faylını konsoldan götürdüyünüz dəyərlərlə doldurun.
`NEXT_PUBLIC_FUNCTIONS_REGION` mütləq `europe-west1` olmalıdır.

`.firebaserc` faylını yaradın:

```json
{ "projects": { "default": "SIZIN-LAYIHE-ID" } }
```

---

## 2. Quraşdırma

```bash
npm install
npm --prefix functions install
npm test          # 84 test keçməlidir
npm run build     # bütün səhifələr yığılmalıdır
```

---

## 3. Yerləşdirmə

Google Cloud Shell və ya öz terminalınızdan:

```bash
firebase login
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
```

`predeploy` addımı `/shared` qovluğunu avtomatik sinxronlaşdırır və TypeScript-i
yığır — ayrıca əmr lazım deyil.

### E-poçt kodları (Resend)

E-poçt təsdiqi olmadan da sistem işləyir — sadəcə həmin düymə xəta qaytarır.
Açmaq üçün:

1. [resend.com](https://resend.com) → qeydiyyat (ayda 3000 mail pulsuz)
2. **API Keys → Create API Key** → açarı kopyalayın
3. `functions/.env` faylına əlavə edin:

   ```
   RESEND_API_KEY=re_xxxxxxxxxxxx
   MAIL_FROM=Qapında <onboarding@resend.dev>
   ```

4. `firebase deploy --only functions:sendEmailCode,functions:verifyEmailCode`

Öz domeninizdən (`destek@qapinda.az`) göndərmək üçün Resend-də domeni təsdiqləyib
`MAIL_FROM`-u dəyişin. Təsdiqlənməmiş domendən göndərilən məktub spam-a düşür.

**Kod serverdə saxlanmır** — yalnız SHA-256 hash-i. `emailVerifications`
kolleksiyasının surəti oğurlansa belə, oradan kod çıxarmaq olmur.

### Funksiyaları deploy etmək

**`firebase deploy --only functions` artıq işləmir** — və bu, kod problemi deyil.

Layihədə 107 funksiya var. `firebase-tools` hamısını bir gedişdə göndərir,
Cloud Shell-in şəbəkəsi buna tab gətirmir və belə xəta çıxır:

```
Failed to make request to https://cloudfunctions.googleapis.com/v2/...
```

Bu, icazə xətası kimi oxunur, amma deyil: icazə problemi olsaydı
`PERMISSION_DENIED` yazardı, və uğursuz gedişdə **bəzi funksiyalar yenə də
keçir** — heç bir icazə xətası buna imkan verməzdi. Səbəb say və sürətdir.

Ona görə:

```bash
npm run deploy:functions     # dəstə-dəstə, uğursuzları bir-bir təkrar edir
npm run deploy:invokers      # sonra callable-lara icazə
```

`deploy:functions` yarımçıq qalsa təkrar işlət — artıq deploy olunanlar
yenidən göndərilmir. Şəbəkə davamlı kəsilirsə Cloud Shell sessiyasını yenilə
(⋮ → Restart).

**`deploy:invokers` niyə ayrıca skriptdir.** Firebase-in öz IAM addımı bu
layihədə işləmir, ona görə `allUsers → roles/run.invoker` əl ilə verilməlidir.
Bunu «bütün Cloud Run servisləri» üzrə döngə ilə etmək **təhlükəlidir**:
`deliverPush` Firestore trigger-idir, `expireStaleOrders` cədvəl işidir —
onları brauzer heç vaxt çağırmır, amma `allUsers` verilsə kənar biri saxta
hadisə göndərib **istənilən istifadəçiyə istənilən push bildirişi** yollaya
bilər. Skript `onCall` olanları mənbədən oxuyub yalnız onlara icazə verir
(93 callable + Epoint webhook-u).

### Push bildirişi və PWA

**Əvvəl necə idi.** Bildiriş yalnız səhifə açıq qaldıqda işləyirdi. Restoran
tableti yatanda, brauzer bağlananda yeni sifariş siqnalı **gəlmirdi** — sifariş
oturur, müştəri gözləyir, sonra dəstəyə yazır.

**İndi.** Firebase Cloud Messaging: server sifarişi restoranın bütün
cihazlarına göndərir — mətbəx tableti, kassa tableti, sahibin telefonu. Səhifə
bağlı olsa belə.

#### Bir dəfəlik qurulum

1. Firebase Console → Project settings → **Cloud Messaging** → Web Push
   certificates → **Generate key pair**.
2. Alınan açarı `.env.local`-a yaz:

   ```
   NEXT_PUBLIC_FIREBASE_VAPID_KEY=BEl6...
   ```

3. `npm run build && firebase deploy`

Açar qoyulmayana qədər sistem sınmır: arxa fon bildirişi işləmir, səhifə açıq
olanda isə köhnə yol həmişəki kimi işləyir.

**iOS üçün əlavə:** Apple Developer → Keys → **APNs** açarı yarat, `.p8` faylını
Firebase Console → Cloud Messaging → Apple app configuration bölməsinə yüklə.
Bu, yalnız iOS tətbiqi üçün lazımdır; veb və Android onsuz işləyir.

#### Necə qurulub

| | |
|---|---|
| Göndərmə | `notifications` kolleksiyasına sənəd yazılanda **trigger** işə düşür |
| Niyə trigger | Tranzaksiya daxilində yazılan bildirişlər `notify()`-dan keçmir — restoranın yeni sifariş siqnalı məhz onlardandır |
| Təkrar | Sənədin id-si deterministikdir, `create` bir dəfə işə düşür |
| Mətn | `functions/src/generated/pushText.ts` — **avtomatik yaradılır**, əl ilə yazılmır |
| Cihaz | `pushTokens/{token}` — token sənədin id-sidir, cihaz başına bir sətir |
| Təmizlik | 60 gün görünməyən token gündəlik işlə silinir |

**Mətn niyə generasiya olunur.** Bildiriş sənədi cümlə yox, **açar** saxlayır —
səbəbi odur ki lüğətlər veb tətbiqlə gedir və serverin yanında ikinci nüsxə
saxlamaq onların ayrılmasına gətirir. Push isə istisnadır: banner-i əməliyyat
sistemi serverin göndərdiyi mətndən çəkir, telefon bir həftədir Qapında-nı
açmayıbsa açar axtarmağa yer yoxdur. Ona görə nüsxə **əl ilə deyil, skriptlə**
yaradılır (`scripts/generate-push-text.mjs`, hər build-də işləyir) və
`tests/push.test.ts` nüsxə köhnəldikdə testi sındırır.

**İkiqat banner tələsi.** Server əsl `notification` bloku göndərir, çünki iOS-da
bağlı tətbiq üçün yalnız bunu çəkir. Bu halda banner-i **brauzerin özü** çəkir.
Service worker əlavə olaraq `showNotification` çağırsaydı, bir sifariş üçün iki
eyni banner çıxardı. Ona görə `public/firebase-messaging-sw.js` **heç nə
çəkmir** — onun işi yalnız toxunuşdur: hansı ekranın açılacağı və artıq açıq olan
pəncərənin təkrar istifadəsi.

**Bannerdə nə yoxdur:** ad, telefon, ünvan. Kilid ekranındakı bildirişi telefonu
əlində tutan hər kəs oxuyur — avtobusda tapan da daxil. Yalnız sifariş kodu və
məbləğ göndərilir.

#### PWA

`public/manifest.json` + ikonlar (`npm run generate:icons` loqodan yaradır).
Restoran tableti «Ana ekrana əlavə et» ilə brauzer səhifəsi yox, **quraşdırılmış
tətbiq** olur — öz ikonu, tam ekran, ünvan sətri yoxdur.

Android launcher-ləri ikonu öz formasına görə kəsir, ona görə `maskable`
variantlar ayrıca hazırlanıb — olmasa loqo Pixel-də künclərini itirir,
Samsung-da itirmir.

### Google və Apple ilə daxil olma

**Qayda dəyişmir: kimlik telefon nömrəsidir.** Google və ya Apple ikinci qapıdır,
əvəzedici deyil — hər iki halda hesab **doğrulanmış nömrə** olmadan tamamlanmır.
«1 telefon 1 hesab» qaydasını qoruyan da budur.

**Apple-ın «Hide My Email» məsələsi.** Apple çox vaxt real e-poçt yerinə
`a1b2c3@privaterelay.appleid.com` verir. Bu ünvan hər tətbiq üçün ayrıdır və
**heç vaxt başqa ünvanla toqquşa bilmir** — yəni onu kilidləmək heç bir təkrarı
tutmur, amma insanın real ünvanının yerini tutur. Nəticədə eyni adam sonra
Google ilə girəndə ikinci hesab yaranır və «1 mail 1 hesab» qaydası pozulur.

Ona görə relay ünvanı **e-poçt sayılmır**: hesab `email: null` ilə açılır, kilid
qoyulmur, real ünvan istəyirsə sonra əlavə edir. Qərar `shared/identity.ts`-də
izah olunub və **serverdə** tətbiq edilir (`registerAccount` + `linkEmail`).

**Apple adı yalnız BİR DƏFƏ göndərir** — həmin Apple ID-nin bu tətbiqi ilk dəfə
təsdiqlədiyi an. Adam qeydiyyatı yarımçıq qoyub səhifəni yeniləsə, ad **birdəfəlik**
itir. Ona görə ad gələn kimi `sessionStorage`-ə yazılır və qeydiyyat addımı oradan
oxuyur.

**Telefonda popup işləmir.** iOS-un tətbiqdaxili brauzerləri (Instagram, Facebook,
Telegram) popup-ı bloklayır — bəziləri bunu bildirmədən. Ona görə popup alınmasa
avtomatik `signInWithRedirect`-ə keçir və qayıdan nəticə `getRedirectResult` ilə
oxunur. Bu olmasa telefonda Google düyməsi **sadəcə heç nə etmir**.

**Hesab toqquşması.** Adam keçən il nömrə ilə qeydiyyatdan keçib, indi Google
düyməsini basır — Firebase `account-exists-with-different-credential` qaytarır.
İkinci hesab açılmır: ekran «hesabınız telefon nömrənizdədir» deyir və telefon
addımına qaytarır. Server qeydiyyatı rədd etsə (nömrə/e-poçt başqasınındır),
**«Telefon nömrəsi ilə yenidən başla»** düyməsi çıxır — həmin yarımçıq Google
kimliyindən çıxış edir, yoxsa növbəti cəhd ona *bağlanmağa* çalışar.

#### Konsolda edilməli işlər

**Google** — Firebase Console → Authentication → Sign-in method → Google aktiv et.
Authorized domains-ə `qapindanew.web.app` və öz domenini əlavə et.

**Apple** — daha uzundur və **Apple Developer Program üzvlüyü tələb edir (ildə 99 USD)**:

1. Apple Developer → Identifiers → **App ID** yarat.
2. **Services ID** yarat (məs. `az.qapinda.web`) və «Sign in with Apple»-ı aktiv et.
3. Return URL: `https://qapindanew.firebaseapp.com/__/auth/handler`
4. Keys → **Sign in with Apple** açarı yarat, `.p8` faylını endir (bir dəfə verilir).
5. Firebase Console → Apple provider → Services ID, Team ID, Key ID və `.p8`-in içindəkini yaz.

Apple qurulmayana qədər düymə `auth/operation-not-allowed` verir və ekran
«bu üsul hələ aktiv deyil» yazır — sistem sınmır.

### Dəstək söhbətində tərcümə

Dəstək müraciətlərindəki hər mesajın altında **«Tərcümə et»** düyməsi var, başlıqda
isə bütün söhbəti tərcümə edən açar. Tərcümə **Google Cloud Translation API** ilə
serverdə edilir — brauzerdə heç bir açar yoxdur.

Bu funksiya işləməzdən əvvəl **bir dəfə** API-ni aktivləşdirmək lazımdır:

```bash
gcloud services enable translate.googleapis.com --project qapindanew
```

Funksiyanın servis hesabına icazə (adətən artıq var; yoxdursa):

```bash
PROJECT_NUMBER=$(gcloud projects describe qapindanew --format='value(projectNumber)')
gcloud projects add-iam-policy-binding qapindanew \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/cloudtranslate.user"
```

Aktivləşdirilməsə sistem sınmır: düymə basılanda «Tərcümə xidməti hazırda əlçatan
deyil» yazısı çıxır, söhbətin qalan hissəsi normal işləyir.

**Qiymət.** Ayda ilk 500 000 simvol pulsuz, sonrası 1 milyon simvola ~20 USD.
Dəstək mesajları qısadır, ona görə praktikada pulsuz həddi keçmək çətindir. Üstəlik
hər tərcümə mesajın üzərində **saxlanılır**: eyni mesajı ikinci dəfə oxuyan
(operator, admin, ertəsi gün qayıdan müştəri) heç nə ödəmir.

**Orijinal heç vaxt silinmir.** Tərcümə mesajın yanında saxlanılır, hər dəfə «maşın
tərcüməsi» kimi işarələnir və bir toxunuşla orijinal geri qayıdır. Dəstək söhbəti
kommersiya mübahisəsinin sənədidir — maşın tərcüməsi onun əvəzi ola bilməz.

### Şəhərlər və rayonlar

`shared/regions.ts` — 74 şəhər/rayon, koordinatları ilə. Bakının 12 rayonu ayrıca.

Bütün ünvanlar və restoranlar **`regionId`** saxlayır, şəhər adını yazmır.
Səbəb sadədir: yazılan şəhər «Bakı», «Baki», «BAKU» kimi üç ayrı bazara bölünür
və heç biri digərini görmür.

Müştərinin şəhəri: brauzerdən **soruşularaq** (avtomatik yox) təyin olunur,
sonra yadda qalır. İcazə verilməsə siyahıdan seçilir.

### İlk super admin

1. Tətbiqə daxil olun və qeydiyyatı tamamlayın (adi müştəri kimi).
2. `functions/.env` faylı yaradın:

   ```
   BOOTSTRAP_ADMIN_SECRET=uzun-tesadufi-en-azi-20-simvol
   ```

3. `firebase deploy --only functions`
4. Brauzerin konsolunda:

   ```js
   const { getFunctions, httpsCallable } = await import(
     'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js'
   );
   ```

   Daha sadəsi: müvəqqəti bir düymə ilə `bootstrapSuperAdmin({ secret })`
   çağırın (`src/firebase/callables.ts` içində hazırdır).
5. **Bitdikdən sonra `BOOTSTRAP_ADMIN_SECRET` sətrini `functions/.env`-dən silin
   və funksiyaları yenidən yerləşdirin.** Bu birdəfəlik açardır.

---

## 4. Memarlıq

```
/shared              ← BİZNES QAYDALARININ YEGANƏ MƏNBƏYI
   enums.ts          statuslar, rollar, ödəniş üsulları
   models.ts         Firestore sənəd tipləri
   collections.ts    yollar və deterministik id-lər
   orderState.ts     sifariş vəziyyət maşını
   pricing.ts        qiymət, kupon, komissiya
   permissions.ts    rol → icazə matrisi
   errors.ts         tərcümə olunan xəta kodları
        │
        ├──► src/shared            (npm run sync:shared)
        └──► functions/src/shared
```

`/shared` qovluğundakı fayllar **kopyalanır**, çünki Firebase yalnız
`functions/` qovluğunu yükləyir. Kopyaları **redaktə etməyin** — orijinalı
dəyişin və `npm run sync:shared` işlədin (`dev`, `build`, `test` bunu özü edir).

### Pul

Bütün məbləğlər **tam ədəd qəpik** kimi saxlanılır (1 ₼ = 100). Faizlər baza
punktu ilə (1200 = 12.00%). Heç yerdə float yoxdur — kalkulyasiya sürüşməsin.

### Kimin nəyə icazəsi var

| | Müştəri | Restoran işçisi | Menecer | Sahib | Operator | Super admin |
|---|---|---|---|---|---|---|
| Menyuya bax | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Menyunu dəyiş | | | ✓ | ✓ | | ✓ |
| «Bitdi» et | | ✓ | ✓ | ✓ | | ✓ |
| Sifariş qəbul et | | ✓ | ✓ | ✓ | | ✓ |
| Maliyyə hesabatı | | | | ✓ | ✓ | ✓ |
| İşçi əlavə et | | | | ✓ | | ✓ |
| Restoran təsdiqlə | | | | | | ✓ |
| Komissiya dəyiş | | | | | | ✓ |
| Rol dəyiş | | | | | | ✓ |

Restoran rolları **həmişə** `restaurantId` ilə məhdudlaşır. İcazə yoxlaması tək
başına kifayət deyil — `canActOnRestaurant` da keçməlidir.

---

## 5. Təhlükəsizlik — nə haradadır

**Müştəri bütün sistemdə cəmi bir şey yaza bilir:** öz bildirişini «oxundu»
etmək. Qalan hər şey Cloud Functions vasitəsilə gedir.

| Risk | Harada bağlanıb |
|---|---|
| Qiyməti brauzerdən dəyişmək | `createOrder` menyunu Firestore-dan oxuyur, gələn qiyməti heç vaxt işlətmir |
| Sifarişi özün «çatdırıldı» etmək | `orderState.ts` — müştəri aktoru üçün belə keçid yoxdur |
| Başqa restoranın sifarişini görmək | `firestore.rules` → `ownsRestaurant()`, `restaurantId` custom claim ilə |
| Özünə admin rolu vermək | Rol yalnız `setUserRole` ilə, yalnız super admin, jurnal ilə |
| Kupondan təkrar istifadə | Limit nömrə + ünvan + cihaz üzrə sayılır, hesab üzrə yox |
| İkiqat sifariş (şəbəkə kəsilməsi) | `clientRequestId` idempotentlik açarı, effektlə eyni tranzaksiyada |
| Kupon kodlarını siyahılamaq | `coupons` kolleksiyası müştəriyə oxunmur |
| Komissiyanı sonradan dəyişmək | `order.commissionRateBps` sifariş anında dondurulur |
| Jurnalı təmizləmək | Heç bir funksiya audit yazısını silmir/dəyişmir |

### Bir telefon, bir mail, bir hesab

Üç qat:

1. **Firebase Auth** bir nömrəni iki hesaba bağlamır.
2. **`phoneIndex` / `emailIndex`** kilidləri istifadəçi sənədi ilə **eyni
   tranzaksiyada** yaradılır. Eyni anda iki qeydiyyat gəlsə, ikincisi düşür.
3. **Mail normallaşdırması** — `a.li+yeni@gmail.com` və `ali@gmail.com` eyni
   kilidi tutur. İnsanlar məhz bu üsulla ikinci hesab açır.

**Dürüst olmaq lazımdır:** heç bir sistem bir adamın **iki telefon nömrəsi**
almasının qarşısını ala bilməz. Ona görə kupon limitləri nömrə + ünvan + cihaz
üzrə sayılır və şübhəli hal avtomatik ban yox, `REVIEW_REQUIRED` — insan baxışı
üçün işarələnir.

---

## 6. Sifarişin yolu

```
PLACED ──restoran qəbul──► ACCEPTED ──► PREPARING ──► READY
   │                                                     │
   │ müştəri ləğv edə bilər                    kuryerə verilir
   │ (yalnız burada)                                     ▼
   ├──restoran imtina──► REJECTED              OUT_FOR_DELIVERY
   └──cavab gecikdi────► EXPIRED                         │
                        (avtomatik)                      ▼
                                                    DELIVERED
                                                         │
                                            60 dəq sonra avtomatik
                                                         ▼
                                                    COMPLETED
                                              (komissiya yazılır)
```

Komissiya yalnız **COMPLETED** anında hesablanır və dəftərə yazılır. Açar
sifariş id-sinə bağlıdır, ona görə işi iki dəfə işlətmək iki dəfə hesab çıxarmır.

### Komissiya kimin hesabına

| Endirimi kim ödəyir | Komissiya bazası | Platforma nə borcludur |
|---|---|---|
| Heç kim (endirim yoxdur) | Yeməklərin cəmi | — |
| Restoran | Cəm **mənfi** endirim | — |
| Platforma | Cəmin **hamısı** | Endirim məbləği restorana qaytarılır |

Komissiya **heç vaxt çatdırılma haqqından** tutulmur — o pul restoranın
maşın xərcidir, gəliri deyil.

---

## 7. Avtomatik işlər

| Funksiya | Nə vaxt | Nə edir |
|---|---|---|
| `expireStaleOrders` | hər dəqiqə | Cavabsız qalan sifarişi ləğv edir |
| `settleDeliveredOrders` | hər 15 dəqiqə | Çatdırılanı tamamlayır, komissiyanı yazır |
| `rollUpSettlements` | hər gün 03:00 | Aylıq hesabı yığır |
| `pruneIdempotencyKeys` | hər gün 04:00 | 30 gündən köhnə açarları silir |

---

## 8. Bilinən boşluqlar

Bunlar **bilərəkdən** açıq qalıb, gizlədilmir:

1. **Hüquqi mətnlər şablondur.** `src/app/hüquqi/[document]/page.tsx` içindəki
   `{{...}}` yerləri doldurulmalı və mətn Azərbaycan hüququ üzrə ixtisaslaşmış
   hüquqşünas tərəfindən yoxlanılmalıdır. İstehsala buraxmazdan əvvəl.
2. **Şəkil yükləmə UI-si yoxdur.** Storage qaydaları hazırdır; menyu fotosu və
   logo üçün yükləmə komponenti yazılmalıdır.
3. **Təhlükəsizlik qaydaları üçün emulyator testləri yazılmayıb.** Qaydalar
   diqqətlə yazılıb, amma avtomatik test yoxdur — `firebase emulators:exec` ilə
   əlavə edilməlidir.
4. **Ünvan çatdırılma zonasında olub-olmaması yoxlanılmır.** Model radiusu
   saxlayır, `ADDRESS_OUT_OF_RANGE` kodu var, amma məsafə hesablaması hələ
   `createOrder`-a qoşulmayıb.
5. **Reytinq və rəy sistemi yoxdur.** `ratingAverage` sahəsi var, doldurulmur.
6. **Şifrə ilə giriş yoxdur** — bilərəkdən. Giriş yalnız SMS və ya Google ilədir,
   ona görə «şifrəmi unutdum» başlığı da yoxdur: unudulacaq şifrə mövcud deyil.
   Nömrəsini itirən istifadəçi üçün bərpa insan qərarıdır — admin panelindən
   hesabın statusu dəyişdirilir. Bu, avtomatik bərpadan daha təhlükəsizdir:
   avtomatik bərpa mexanizmi ən çox istifadə edilən hesab oğurluğu yoludur.
7. **Onlayn ödəniş yoxdur** — bilərəkdən. Model, statuslar və UI-dakı yeri
   hazırdır; provayder adapteri (Epoint/PayTR) yazılanda əlavə olunacaq.
   Provayderin **real sənədləri ilə yoxlanılmalıdır** — mən onları görmədim.

---

## 9. Faydalı əmrlər

```bash
npm run dev              # yerli inkişaf
npm test                 # 84 test
npm run typecheck        # TypeScript
npm run lint             # ESLint
npm run sync:shared      # /shared → src + functions
npm run emulators        # yerli Firebase emulyatorları
npm run deploy:rules     # yalnız qaydalar və indekslər
npm run deploy:functions # yalnız funksiyalar
```
