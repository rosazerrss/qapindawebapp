import type { LegalDocuments } from './types';

/**
 * Azerbaijani legal texts — the source language. The Russian and English files
 * are translations of these; if a sentence changes here, change it there too.
 */
export const LEGAL_AZ: LegalDocuments = {
  terms: {
    title: 'İstifadə şərtləri',
    intro:
      'Bu sənəd Qapında platformasından necə istifadə olunduğunu izah edir: kim nəyə cavabdehdir, sifariş necə verilir və problem yaranarsa nə edilir. Sadə dildə yazılmışdır, çünki onu oxuyan hüquqşünas deyil, yemək sifariş edən adamdır.',
    version: 'Versiya 1.0',
    effectiveDate: 'Qüvvəyə minmə tarixi: 1 sentyabr 2026',
    sections: [
      {
        heading: '1. Biz kimik və nə deyilik',
        body: [
          'Qapında — restoranlarla müştəriləri bir araya gətirən onlayn platformadır. Platformanı {{OPERATOR_LEGAL_NAME}} (VÖEN: {{OPERATOR_TAX_ID}}, ünvan: {{OPERATOR_ADDRESS}}) idarə edir.',
          'Biz restoran deyilik. Yemək bişirmirik, menyunu biz tərtib etmirik və qiymətləri biz təyin etmirik.',
          'Biz kuryer şirkəti də deyilik. Bizim kuryerimiz yoxdur. Sifarişi restoranın öz kuryeri çatdırır.',
          'Bizim işimiz platformadır: restoranların menyusunu göstərmək, sifarişinizi restorana ötürmək, sifarişin gedişatını izləməyə imkan vermək və dəstək göstərmək.',
        ],
      },
      {
        heading: '2. Bu şərtlər kimə aiddir',
        body: [
          'Şərtlər Qapında saytından və ya tətbiqindən istifadə edən hər kəsə aiddir — sadəcə menyuya baxsanız da.',
          'Hesab açmaqla və ya sifariş verməklə siz bu şərtləri qəbul etmiş olursunuz. Razı deyilsinizsə, platformadan istifadə etməyin.',
          'Restoranlarla münasibətimiz ayrıca tərəfdaşlıq müqaviləsi ilə tənzimlənir; bu sənəd müştərilər üçündür.',
        ],
      },
      {
        heading: '3. Hesab və giriş',
        body: [
          'Sifariş vermək üçün 18 yaşınız tamam olmalıdır.',
          'Bir insan — bir hesab. Bir telefon nömrəsi və bir e-poçt ünvanı yalnız bir hesaba bağlana bilər.',
          'Giriş telefon nömrəsi ilə (SMS kodu) və ya Google hesabı ilə edilir. Parol yoxdur, ona görə də oğurlanacaq parol da yoxdur.',
          'SMS kodunu heç kimə verməyin — nə bizim adımızdan zəng edənə, nə restorana, nə də kuryerə. Biz sizdən heç vaxt SMS kodu soruşmuruq.',
          'Hesabınızdan verilən sifarişlərə görə siz cavabdehsiniz. Telefonunuzu itirsəniz və ya nömrənizi başqasına versəniz, bizə bildirin.',
          'Ad, telefon və ünvan məlumatlarının düzgün olması sizin məsuliyyətinizdədir. Səhv ünvana getmiş sifariş üçün restoran cavabdeh deyil.',
        ],
      },
      {
        heading: '4. Sifariş və müqavilənin bağlanması',
        body: [
          'Menyudakı yeməklər təklifdir, zəmanət deyil. Restoran hazırda hansı yeməyin olduğunu özü göstərir.',
          'Sifarişi göndərəndə siz restorana təklif vermiş olursunuz. Müqavilə həmin an bağlanmır.',
          'Alqı-satqı müqaviləsi restoran sifarişinizi qəbul edən an bağlanır. Müqavilə sizinlə restoran arasındadır. Qapında bu müqavilənin tərəfi deyil.',
          'Restoran sifarişi qəbul etməyə bilər — məsələn, yemək qurtarıbsa, sifariş çox uzağadırsa və ya restoran bağlanmaq üzrədirsə. Bu halda sizdən pul alınmır.',
          'Qapında vasitəçidir və bu xidmətə görə restorandan komissiya alır. Komissiya restoran tərəfindən ödənilir; sifarişin qiymətinə görə sizdən əlavə platforma haqqı tutulmur.',
        ],
      },
      {
        heading: '5. Qiymətlər, çatdırılma haqqı və minimum sifariş',
        body: [
          'Qiymətləri restoran təyin edir. Menyuda görünən qiymətlər manatladır.',
          'Hər restoranın öz çatdırılma haqqı və minimum sifariş məbləği ola bilər. Bunlar sifarişi təsdiqləməzdən əvvəl səbətdə açıq göstərilir.',
          'Sifarişin yekun məbləği sifarişi göndərdiyiniz anda hesablanır və dondurulur. Restoran sonradan menyu qiymətini dəyişsə, bu, artıq verilmiş sifarişə təsir etmir.',
          'Nadir hallarda menyuda texniki səhv ola bilər — məsələn, qiymət açıq-aydın yanlış göstərilibsə. Belə halda restoran sifarişi qəbul etməkdən imtina edə bilər və siz heç nə ödəmirsiniz.',
        ],
      },
      {
        heading: '6. Ödəniş qapıda',
        body: [
          'Ödəniş yalnız qapıda edilir: nağd və ya kuryerin terminalı vasitəsilə kartla.',
          'Hazırda platformada onlayn ödəniş yoxdur. Qapında sizdən pul almır, kart məlumatlarınızı görmür, emal etmir və saxlamır. Sayt və ya tətbiq sizdən kart nömrəsi istəsə, bu saxtakarlıqdır — dərhal bizə bildirin.',
          'Pulu restorana və ya onun kuryerinə verirsiniz. Qəbz və ya çek tələb etmək hüququnuz var.',
          'Nağd ödəniş üçün qaytarılası pulun olması restoranın öhdəliyidir, amma böyük əskinasla ödəyəcəksinizsə, sifarişin qeyd hissəsində yazsanız hamı üçün rahat olar.',
        ],
      },
      {
        heading: '7. Ləğv və imtina',
        body: [
          'Restoran sifarişi qəbul etməmişdən əvvəl siz onu tətbiq üzərindən ödənişsiz ləğv edə bilərsiniz.',
          'Restoran sifarişi qəbul etdikdən sonra yemək hazırlanmağa başlayır. Bu mərhələdə ləğv restoranın razılığı ilə mümkündür — bizimlə və ya birbaşa restoranla əlaqə saxlayın.',
          'Restoran sifarişi qəbul etdikdən sonra da ləğv edə bilər, əgər obyektiv səbəb varsa: yemək bitib, kuryer yoxdur, ünvan çatdırılma zonasından kənardadır. Səbəb sizə bildirilir.',
          'Yemək qapınıza gətiriləndə əsaslı səbəb olmadan qəbul etməkdən imtina etmək restorana zərər vurur. Belə halların təkrarlanması hesabın yoxlanmasına səbəb ola bilər.',
          'Yemək gətirilmədisə, səhv gətirildisə və ya yararsız vəziyyətdədirsə — ödəməkdən imtina edə və ya pulun qaytarılmasını tələb edə bilərsiniz. Bu tələb restorana ünvanlanır; biz sizə kömək edirik.',
        ],
      },
      {
        heading: '8. Şikayət və kim nəyə cavabdehdir',
        body: [
          'Restoran cavabdehdir: yeməyin keyfiyyəti, tərkibi, allergenlər, qablaşdırma, hazırlanma və çatdırılma müddəti, kuryerin davranışı, çatdırılan sifarişin tamlığı.',
          'Qapında cavabdehdir: platformanın işləməsi, sifarişin restorana düzgün ötürülməsi, məlumatlarınızın qorunması, dəstək və restoranla aranızda vasitəçilik.',
          'Yeməklə və ya çatdırılma ilə bağlı problemi ən tez restoranla həll etmək olur. Cavab ala bilmirsinizsə, {{SUPPORT_EMAIL}} ünvanına yazın və ya {{SUPPORT_PHONE}} nömrəsinə zəng edin — sifariş nömrəsini bildirin.',
          'Şikayətinizi qeydə alırıq, restorandan izahat istəyirik və nəticəni sizə bildiririk. Restoran haqqında şikayətlər çoxalarsa, onun platformadakı statusuna yenidən baxa bilərik.',
          'Bu şərtlər istehlakçı kimi qanunla sizə verilən hüquqları məhdudlaşdırmır.',
        ],
      },
      {
        heading: '9. Rəylər',
        body: [
          'Rəy yalnız həmin sifarişi həqiqətən qəbul etmiş şəxs tərəfindən yazıla bilər. Sifariş verməmiş adam rəy yaza bilmir.',
          'Rəydə tam adınız görünmür. Digər istifadəçilər adınızın qısaldılmış formasını görür — məsələn, «Aysel M.».',
          'Rəy düzgün və öz təcrübənizə əsaslanmalıdır. Söyüş, təhqir, şəxsi məlumat, reklam və başqasının adından yazılan mətn qəbul edilmir.',
          'Qaydalara uyğun olmayan rəy moderator tərəfindən gizlədilir və gizlədilmə səbəbi sistemdə qeyd olunur. Rəyləri səssizcə silmirik.',
          'Restoran öz haqqındakı rəyi silə bilmir və gizlədə bilmir. Bunu yalnız moderator, səbəb göstərməklə edir.',
          'Mənfi, amma düzgün və nəzakətli rəy silinmir. Belə rəylər restorana da, digər müştərilərə də faydalıdır.',
        ],
      },
      {
        heading: '10. Kuponlar və endirimlər',
        body: [
          'Kupon limitləri hesaba görə deyil, insana görə hesablanır — telefon nömrəsi, cihaz və çatdırılma ünvanı nəzərə alınır.',
          'Yeni kupon almaq üçün əlavə hesab açmaq qadağandır.',
          'Sui-istifadə aşkarlandıqda kupon ləğv edilir, endirim geri hesablanır və hesab yoxlamaya göndərilə bilər.',
          'Kupon şərtləri (minimum məbləğ, müddət, hansı restoranlara aid olması) kuponun özündə göstərilir.',
        ],
      },
      {
        heading: '11. Qadağan olunan istifadə',
        body: [
          'Yalan ad, başqasının telefon nömrəsi və ya uydurma ünvanla sifariş vermək.',
          'Çoxsaylı hesab açmaq, kupon və ya reytinq sistemini aldatmaq.',
          'Restoranlara, kuryerlərə və ya dəstək əməkdaşlarına qarşı təhqir, hədə və ya ayrı-seçkilik.',
          'Platformanı avtomatik vasitələrlə yükləmək, məlumatları kütləvi toplamaq, təhlükəsizliyi sınamaq və ya sistemi pozmağa cəhd etmək.',
          'Platformadan qanunsuz məqsədlər üçün istifadə etmək.',
        ],
      },
      {
        heading: '12. Hesabın dayandırılması',
        body: [
          'Bu şərtlər pozularsa, hesabı müvəqqəti dayandıra və ya bağlaya bilərik.',
          'Dayandırma səbəbini sizə bildiririk və izahat vermək imkanı veririk. Səhv olduğunu düşünürsünüzsə, dəstəyə yazın — qərara yenidən baxılır.',
          'Ciddi hallarda (saxtakarlıq, hədə, təhlükəsizliyə hücum) hesabı əvvəlcədən xəbərdarlıq etmədən dayandıra bilərik.',
          'Hesabınızı istənilən vaxt özünüz bağlaya bilərsiniz. Sifariş və maliyyə qeydləri qanunun tələb etdiyi müddət ərzində anonimləşdirilmiş şəkildə qalır — bu barədə Məxfilik bildirişində yazılıb.',
        ],
      },
      {
        heading: '13. Şərtlərdə dəyişiklik',
        body: [
          'Şərtləri vaxtaşırı yeniləyirik. Hər versiyanın nömrəsi və qüvvəyə minmə tarixi bu səhifənin yuxarısında göstərilir.',
          'Əhəmiyyətli dəyişiklikləri tətbiq vasitəsilə əvvəlcədən bildiririk.',
          'Dəyişiklikdən sonra platformadan istifadə etməyə davam etsəniz, yeni versiyanı qəbul etmiş sayılırsınız. Razı deyilsinizsə, hesabınızı bağlaya bilərsiniz.',
        ],
      },
      {
        heading: '14. Məsuliyyətin hüdudları',
        body: [
          'Platformanın fasiləsiz işləyəcəyinə zəmanət vermirik. İnternet, server və ya restoranın öz sistemi ilə bağlı problemlər ola bilər. Belə fasilələri mümkün qədər tez aradan qaldırırıq.',
          'Yeməyin keyfiyyətinə, tərkibinə, çatdırılma müddətinə və kuryerin davranışına görə birbaşa məsuliyyət restoranın üzərindədir, çünki bu işləri restoran görür.',
          'Bizim öz səhvimizə görə — məsələn, sifarişi restorana səhv ötürsək — məsuliyyəti üzərimizə götürürük.',
          'Qanunla məsuliyyətdən azad ola bilmədiyimiz hallarda (o cümlədən qəsdən və ya kobud ehtiyatsızlıqla vurulan zərər, insan sağlamlığına zərər) bu bənd tətbiq olunmur. Məsuliyyəti tamamilə inkar etmirik — sadəcə kimin nəyə görə cavabdeh olduğunu dürüst göstəririk.',
        ],
      },
      {
        heading: '15. Tətbiq olunan qanun və mübahisələr',
        body: [
          'Bu şərtlərə Azərbaycan Respublikasının qanunvericiliyi tətbiq olunur.',
          'Mübahisəni əvvəlcə danışıqla həll etməyə çalışırıq. Müraciətinizə ağlabatan müddət ərzində cavab veririk.',
          'Razılıq əldə olunmasa, mübahisə Azərbaycan Respublikasının səlahiyyətli məhkəmələrində baxılır. İstehlakçı kimi qanunla sizə verilən müraciət hüquqları saxlanılır.',
        ],
      },
      {
        heading: '16. Əlaqə',
        body: [
          'E-poçt: {{SUPPORT_EMAIL}}',
          'Telefon: {{SUPPORT_PHONE}}',
          'Operator: {{OPERATOR_LEGAL_NAME}}, ünvan: {{OPERATOR_ADDRESS}}, VÖEN: {{OPERATOR_TAX_ID}}',
        ],
      },
    ],
  },

  privacy: {
    title: 'Məxfilik bildirişi',
    intro:
      'Bu bildiriş hansı məlumatlarınızı topladığımızı, niyə topladığımızı, kimlərlə paylaşdığımızı və üzərində hansı hüquqlarınızın olduğunu izah edir. Məlumatlarınızı satmırıq.',
    version: 'Versiya 1.0',
    effectiveDate: 'Qüvvəyə minmə tarixi: 1 sentyabr 2026',
    sections: [
      {
        heading: '1. Qısaca',
        body: [
          'Sifarişi çatdırmaq üçün lazım olan məlumatları toplayırıq: adınız, telefonunuz, ünvanınız və sifarişin özü.',
          'Bu məlumatları yalnız sifarişi çatdıracaq restoranla paylaşırıq — başqa restoranla yox.',
          'Kart məlumatlarınızı görmürük, çünki ödəniş qapıda edilir.',
          'Məlumatların operatoru {{OPERATOR_LEGAL_NAME}}-dır (ünvan: {{OPERATOR_ADDRESS}}).',
        ],
      },
      {
        heading: '2. Hansı məlumatları toplayırıq',
        body: [
          'Hesab məlumatları: ad və soyad, telefon nömrəsi, e-poçt ünvanı (Google ilə giriş etsəniz və ya özünüz əlavə etsəniz).',
          'Çatdırılma ünvanları: yazdığınız ünvan mətni, mənzil və qeydlər, həmçinin xəritədə özünüz seçdiyiniz koordinatlar.',
          'Sifariş tarixçəsi: nə sifariş etdiyiniz, hansı restorandan, hansı məbləğə, hansı vaxtda, sifarişin statusu və varsa ləğv səbəbi.',
          'Rəyləriniz və reytinqləriniz.',
          'Cihaz tanıyıcıları: kupon və endirim sui-istifadəsini aşkarlamaq üçün istifadə olunan texniki identifikator.',
          'İstifadə jurnalları: IP ünvanı, brauzer və cihaz növü, hansı səhifələri açdığınız, xəta hesabatları.',
          'Dəstəyə yazdığınız müraciətlərin məzmunu.',
          'Bilmədən topladığımız gizli məlumat yoxdur: mikrofonunuzu dinləmirik, telefon kitabçanızı və qalereyanızı oxumuruq. Yeriniz yalnız siz xəritədə nöqtə seçdiyiniz və ya «Məni tap» düyməsinə basdığınız halda istifadə olunur.',
        ],
      },
      {
        heading: '3. Niyə toplayırıq və hansı əsasla',
        body: [
          'Müqavilənin icrası üçün: sifarişi qəbul etmək, restorana ötürmək, çatdırılmasını təmin etmək, statusu göstərmək və dəstək vermək. Bu məlumatlar olmadan sifariş mümkün deyil.',
          'Qanuni öhdəlik üçün: maliyyə, vergi və mühasibat qeydlərinin saxlanması.',
          'Qanuni maraq üçün: saxtakarlığın və kupon sui-istifadəsinin qarşısını almaq, platformanın təhlükəsizliyini qorumaq, xətaları tapmaq və xidməti yaxşılaşdırmaq. Bu maraqla sizin hüquqlarınız arasında tarazlığı gözləyirik.',
          'Razılıq əsasında: marketinq bildirişləri və statistika kukiləri. Razılığı istənilən vaxt geri götürə bilərsiniz; bu, sifariş vermək imkanınıza təsir etmir.',
        ],
      },
      {
        heading: '4. Kimlərlə paylaşırıq',
        body: [
          'Sifariş verdiyiniz restoranla: adınız, telefon nömrəniz, çatdırılma ünvanınız və sifarişin məzmunu. Bunlar restorana yeməyi bişirib qapınıza çatdırmaq üçün lazımdır.',
          'Restoran yalnız öz sifarişlərini görür. Başqa restoranın müştərilərini, sizin digər sifarişlərinizi və e-poçt ünvanınızı görmür.',
          'Texniki təchizatçılarımızla: server, məlumat bazası, SMS göndərilməsi və xəta izləmə xidmətləri. Onlar məlumatı yalnız bizim tapşırığımızla emal edir və öz məqsədləri üçün istifadə edə bilmir.',
          'Səlahiyyətli dövlət orqanları ilə — yalnız qanun tələb etdikdə və tələb olunan həcmdə.',
          'Bunlardan başqa heç kimlə. Məlumatlarınızı satmırıq və reklam brokerlərinə vermirik.',
        ],
      },
      {
        heading: '5. Kart və ödəniş məlumatları',
        body: [
          'Platformada onlayn ödəniş yoxdur. Ödəniş qapıda nağd və ya kartla edilir.',
          'Kart nömrənizi, CVV-ni və ya bank hesab məlumatlarınızı görmürük, emal etmirik və saxlamırıq.',
          'Yalnız sifarişin ödəniş üsulunu (nağd və ya kart) və məbləğini qeyd edirik — bu, mühasibat və mübahisələr üçün lazımdır.',
        ],
      },
      {
        heading: '6. Adınız necə görünür',
        body: [
          'Tam adınız heç vaxt açıq şəkildə göstərilmir.',
          'Rəylərdə adınızın qısaldılmış forması görünür — məsələn, «Aysel M.».',
          'Tam adınızı yalnız sifarişi çatdıran restoran və zəruri hallarda dəstək əməkdaşımız görür.',
        ],
      },
      {
        heading: '7. Nə qədər saxlayırıq',
        body: [
          'Hesab məlumatları hesabınız aktiv olduğu müddətdə saxlanılır.',
          'Sifariş və maliyyə qeydləri qanunun tələb etdiyi müddət ərzində saxlanılır. Bu müddət mühasibat və vergi qanunvericiliyi ilə müəyyən olunur və bizim istəyimizdən asılı deyil.',
          'Hesabınızı bağladıqda şəxsi məlumatlarınız silinmir, anonimləşdirilir: ad, telefon, e-poçt və ünvan qeydlərdən çıxarılır və sifariş yalnız məbləğ, tarix və restoran kimi qalır. Bu qeydə görə sizi tanımaq mümkün olmur.',
          'Bunu ona görə edirik ki, qanun maliyyə qeydini saxlamağı tələb edir, amma o qeyddə sizin adınızın qalmasını tələb etmir.',
          'İstifadə jurnalları qısa müddət saxlanılır — təhlükəsizlik hadisəsi araşdırılmırsa, adətən bir neçə ay.',
        ],
      },
      {
        heading: '8. Hüquqlarınız',
        body: [
          'Məlumatlarınızın surətini almaq hüququnuz var — «Hesabım» bölməsindən yükləyə və ya bizdən istəyə bilərsiniz.',
          'Səhv məlumatı düzəltmək hüququnuz var. Ad, telefon və ünvanları özünüz redaktə edə bilərsiniz.',
          'Silmək hüququnuz var. Hesabı bağladıqda məlumatlarınız yuxarıda yazıldığı kimi anonimləşdirilir; qanunun saxlamağı tələb etdiyi qeydlər anonim şəkildə qalır.',
          'Emala etiraz etmək və razılığı geri götürmək hüququnuz var — xüsusən marketinq və statistika üçün.',
          'Bu hüquqlardan istifadə etmək üçün {{SUPPORT_EMAIL}} ünvanına yazın. Şəxsiyyətinizi təsdiqləyib müraciətinizə ağlabatan müddətdə, ən geci bir ay ərzində cavab veririk. Bu xidmət ödənişsizdir.',
          'Cavabımızdan razı qalmasanız, Azərbaycan Respublikasının fərdi məlumatların mühafizəsi üzrə səlahiyyətli orqanına şikayət etmək hüququnuz var.',
        ],
      },
      {
        heading: '9. Kukilər və oxşar texnologiyalar',
        body: [
          'Sessiyanı, dil seçimini və səbəti yadda saxlamaq üçün zəruri kukilərdən istifadə edirik. Onlarsız sayt işləmir.',
          'Statistika kukiləri yalnız razılığınızla yerləşdirilir.',
          'Cihaz tanıyıcısı kupon sui-istifadəsini aşkarlamaq üçün istifadə olunur; reklam məqsədi ilə istifadə edilmir.',
          'Ətraflı məlumat Kuki bildirişindədir.',
        ],
      },
      {
        heading: '10. Uşaqlar',
        body: [
          'Platforma 18 yaşdan kiçiklər üçün nəzərdə tutulmayıb və biz bilərəkdən onların məlumatlarını toplamırıq.',
          'Uşağın məlumatının bizdə olduğunu düşünürsünüzsə, {{SUPPORT_EMAIL}} ünvanına yazın — yoxlayıb siləcəyik.',
        ],
      },
      {
        heading: '11. Təhlükəsizlik',
        body: [
          'Məlumatlar şifrələnmiş bağlantı üzərindən ötürülür.',
          'Məlumatlara giriş rola görə məhdudlaşdırılıb: hər əməkdaş yalnız işi üçün lazım olanı görür.',
          'İdarəçi əməliyyatları jurnalda qeyd olunur.',
          'Heç bir sistem tam təhlükəsiz deyil. Məlumatlarınıza aid ciddi təhlükəsizlik hadisəsi baş verərsə, qanunun tələb etdiyi qaydada sizi və səlahiyyətli orqanı məlumatlandırırıq.',
        ],
      },
      {
        heading: '12. Dəyişikliklər və əlaqə',
        body: [
          'Bu bildirişi yeniləyə bilərik. Versiya nömrəsi və tarix yuxarıda göstərilir; əhəmiyyətli dəyişiklikləri ayrıca bildiririk.',
          'Suallarınız üçün: {{SUPPORT_EMAIL}}, {{SUPPORT_PHONE}}.',
        ],
      },
    ],
  },

  cookies: {
    title: 'Kuki bildirişi',
    intro:
      'Qısa bildiriş: brauzerinizdə hansı məlumatları saxlayırıq və niyə. Reklam kukiləri istifadə etmirik.',
    version: 'Versiya 1.0',
    effectiveDate: 'Qüvvəyə minmə tarixi: 1 sentyabr 2026',
    sections: [
      {
        heading: '1. Zəruri kukilər',
        body: [
          'Hesaba girişinizi, dil seçiminizi, seçdiyiniz bölgəni və səbətinizi yadda saxlayır.',
          'Bunlarsız sayt işləmir, ona görə də razılıq tələb olunmur.',
        ],
      },
      {
        heading: '2. Statistika kukiləri',
        body: [
          'Hansı səhifələrin işlədiyini və harada xəta baş verdiyini anlamağa kömək edir.',
          'Yalnız razılığınızla yerləşdirilir. «Yalnız zəruri» seçsəniz, heç vaxt yazılmır.',
        ],
      },
      {
        heading: '3. Reklam kukiləri',
        body: ['İstifadə etmirik. Sizi başqa saytlarda izləmirik və məlumatınızı reklam şəbəkələrinə vermirik.'],
      },
      {
        heading: '4. Seçiminizi dəyişmək',
        body: [
          'Brauzerin ayarlarından bu sayta aid məlumatları təmizləsəniz, seçim pəncərəsi yenidən görünəcək və seçimi yenidən edə biləcəksiniz.',
          'Zəruri kukiləri bloklasanız, giriş və səbət kimi funksiyalar işləməyəcək.',
        ],
      },
      {
        heading: '5. Əlaqə',
        body: ['Suallar üçün: {{SUPPORT_EMAIL}}'],
      },
    ],
  },
};
