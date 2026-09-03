/**
 * Translates a `like` pattern into a SQLite `GLOB` pattern that matches exactly
 * the same strings as the in-memory rule in `predicates.ts`, so text filters can
 * be pushed into SQL instead of pulled into the Worker (issue #41).
 *
 * The trick is to fold the *pattern*, not the data: the pattern is short, the
 * data is long, and `GLOB` supports character classes. `contains "ärger"`
 * becomes `*[äÄ][rR][gG][eE][rR]*`, which SQLite evaluates without any
 * knowledge of Unicode case — the class enumerates the variants up front.
 *
 * SQLite's own `LIKE` is not an option: it folds ASCII only, so
 * `v LIKE '%ä%'` misses `ÄRGER` while `v GLOB '*[äÄ]*'` finds it. `GLOB` also
 * has no `ESCAPE` clause, so its three metacharacters are escaped as
 * single-member classes (`[*]`, `[?]`, `[[]`) instead.
 *
 * Two divergences from the in-memory rule are accepted rather than fixed, both
 * documented in docs/projection-indexes.md:
 * - `_` becomes `?`, which is one *code point* in GLOB and one UTF-16 *code
 *   unit* in memory, so they disagree on astral-plane data. `contains` is
 *   unaffected because it escapes `_`.
 * - SQLite's UTF-8 reader collapses unpaired surrogates that the in-memory rule
 *   keeps distinct.
 */

/**
 * Multi-member case-fold groups over the BMP, one group per whitespace-separated
 * run, each run being the class body to emit for any of its members.
 *
 * Generated from the ES `Canonicalize` used by a non-`u` regexp `i` flag, which
 * is what `likePatternRegex` relies on:
 *
 *     const upper = char.toUpperCase();
 *     if (upper.length !== 1) return char;                 // ß -> SS: no fold
 *     if (char >= U+0080 && upper < U+0080) return char;   // ı -> I: no fold
 *     return upper;
 *
 * Embedded rather than computed at import: scanning the BMP to rebuild it costs
 * 35-60 ms, which a Worker isolate pays on every cold start, while rehydrating
 * this string into a Map costs about 1 ms. `tests/core/like-glob.test.ts`
 * regenerates it from the running engine and fails if they differ, because the
 * in-memory side is whatever *this runtime's* regexp `i` does — a V8 Unicode
 * data update would otherwise move the in-memory rule and leave the SQL rule
 * behind.
 *
 * Single-member groups are omitted: they are the overwhelming majority and a
 * character that folds to nothing else is emitted raw. Groups are ordered by
 * their first code unit purely so the table stays diffable.
 */
const CASE_FOLD_GROUPS: string = [
  "Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll",
  "Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx",
  "Yy Zz µΜμ Àà Áá Ââ Ãã Ää Åå Ææ Çç Èè",
  "Éé Êê Ëë Ìì Íí Îî Ïï Ðð Ññ Òò Óó Ôô",
  "Õõ Öö Øø Ùù Úú Ûû Üü Ýý Þþ ÿŸ Āā Ăă",
  "Ąą Ćć Ĉĉ Ċċ Čč Ďď Đđ Ēē Ĕĕ Ėė Ęę Ěě",
  "Ĝĝ Ğğ Ġġ Ģģ Ĥĥ Ħħ Ĩĩ Īī Ĭĭ Įį Ĳĳ Ĵĵ",
  "Ķķ Ĺĺ Ļļ Ľľ Ŀŀ Łł Ńń Ņņ Ňň Ŋŋ Ōō Ŏŏ",
  "Őő Œœ Ŕŕ Ŗŗ Řř Śś Ŝŝ Şş Šš Ţţ Ťť Ŧŧ",
  "Ũũ Ūū Ŭŭ Ůů Űű Ųų Ŵŵ Ŷŷ Źź Żż Žž ƀɃ",
  "Ɓɓ Ƃƃ Ƅƅ Ɔɔ Ƈƈ Ɖɖ Ɗɗ Ƌƌ Ǝǝ Əə Ɛɛ Ƒƒ",
  "Ɠɠ Ɣɣ ƕǶ Ɩɩ Ɨɨ Ƙƙ ƚȽ ƛꟜ Ɯɯ Ɲɲ ƞȠ Ɵɵ",
  "Ơơ Ƣƣ Ƥƥ Ʀʀ Ƨƨ Ʃʃ Ƭƭ Ʈʈ Ưư Ʊʊ Ʋʋ Ƴƴ",
  "Ƶƶ Ʒʒ Ƹƹ Ƽƽ ƿǷ Ǆǅǆ Ǉǈǉ Ǌǋǌ Ǎǎ Ǐǐ Ǒǒ Ǔǔ",
  "Ǖǖ Ǘǘ Ǚǚ Ǜǜ Ǟǟ Ǡǡ Ǣǣ Ǥǥ Ǧǧ Ǩǩ Ǫǫ Ǭǭ",
  "Ǯǯ Ǳǲǳ Ǵǵ Ǹǹ Ǻǻ Ǽǽ Ǿǿ Ȁȁ Ȃȃ Ȅȅ Ȇȇ Ȉȉ",
  "Ȋȋ Ȍȍ Ȏȏ Ȑȑ Ȓȓ Ȕȕ Ȗȗ Șș Țț Ȝȝ Ȟȟ Ȣȣ",
  "Ȥȥ Ȧȧ Ȩȩ Ȫȫ Ȭȭ Ȯȯ Ȱȱ Ȳȳ Ⱥⱥ Ȼȼ Ⱦⱦ ȿⱾ",
  "ɀⱿ Ɂɂ Ʉʉ Ʌʌ Ɇɇ Ɉɉ Ɋɋ Ɍɍ Ɏɏ ɐⱯ ɑⱭ ɒⱰ",
  "ɜꞫ ɡꞬ ɤꟋ ɥꞍ ɦꞪ ɪꞮ ɫⱢ ɬꞭ ɱⱮ ɽⱤ ʂꟅ ʇꞱ",
  "ʝꞲ ʞꞰ ͅΙιι Ͱͱ Ͳͳ Ͷͷ ͻϽ ͼϾ ͽϿ Ϳϳ Άά Έέ",
  "Ήή Ίί Όό Ύύ Ώώ Αα Ββϐ Γγ Δδ Εεϵ Ζζ Ηη",
  "Θθϑ Κκϰ Λλ Νν Ξξ Οο Ππϖ Ρρϱ Σςσ Ττ Υυ Φφϕ",
  "Χχ Ψψ Ωω Ϊϊ Ϋϋ Ϗϗ Ϙϙ Ϛϛ Ϝϝ Ϟϟ Ϡϡ Ϣϣ",
  "Ϥϥ Ϧϧ Ϩϩ Ϫϫ Ϭϭ Ϯϯ ϲϹ Ϸϸ Ϻϻ Ѐѐ Ёё Ђђ",
  "Ѓѓ Єє Ѕѕ Іі Її Јј Љљ Њњ Ћћ Ќќ Ѝѝ Ўў",
  "Џџ Аа Бб Ввᲀ Гг Ддᲁ Ее Жж Зз Ии Йй Кк",
  "Лл Мм Нн Ооᲂ Пп Рр Ссᲃ Ттᲄᲅ Уу Фф Хх Цц",
  "Чч Шш Щщ Ъъᲆ Ыы Ьь Ээ Юю Яя Ѡѡ Ѣѣᲇ Ѥѥ",
  "Ѧѧ Ѩѩ Ѫѫ Ѭѭ Ѯѯ Ѱѱ Ѳѳ Ѵѵ Ѷѷ Ѹѹ Ѻѻ Ѽѽ",
  "Ѿѿ Ҁҁ Ҋҋ Ҍҍ Ҏҏ Ґґ Ғғ Ҕҕ Җҗ Ҙҙ Ққ Ҝҝ",
  "Ҟҟ Ҡҡ Ңң Ҥҥ Ҧҧ Ҩҩ Ҫҫ Ҭҭ Үү Ұұ Ҳҳ Ҵҵ",
  "Ҷҷ Ҹҹ Һһ Ҽҽ Ҿҿ Ӏӏ Ӂӂ Ӄӄ Ӆӆ Ӈӈ Ӊӊ Ӌӌ",
  "Ӎӎ Ӑӑ Ӓӓ Ӕӕ Ӗӗ Әә Ӛӛ Ӝӝ Ӟӟ Ӡӡ Ӣӣ Ӥӥ",
  "Ӧӧ Өө Ӫӫ Ӭӭ Ӯӯ Ӱӱ Ӳӳ Ӵӵ Ӷӷ Ӹӹ Ӻӻ Ӽӽ",
  "Ӿӿ Ԁԁ Ԃԃ Ԅԅ Ԇԇ Ԉԉ Ԋԋ Ԍԍ Ԏԏ Ԑԑ Ԓԓ Ԕԕ",
  "Ԗԗ Ԙԙ Ԛԛ Ԝԝ Ԟԟ Ԡԡ Ԣԣ Ԥԥ Ԧԧ Ԩԩ Ԫԫ Ԭԭ",
  "Ԯԯ Աա Բբ Գգ Դդ Եե Զզ Էէ Ըը Թթ Ժժ Իի",
  "Լլ Խխ Ծծ Կկ Հհ Ձձ Ղղ Ճճ Մմ Յյ Նն Շշ",
  "Ոո Չչ Պպ Ջջ Ռռ Սս Վվ Տտ Րր Ցց Ււ Փփ",
  "Քք Օօ Ֆֆ Ⴀⴀ Ⴁⴁ Ⴂⴂ Ⴃⴃ Ⴄⴄ Ⴅⴅ Ⴆⴆ Ⴇⴇ Ⴈⴈ",
  "Ⴉⴉ Ⴊⴊ Ⴋⴋ Ⴌⴌ Ⴍⴍ Ⴎⴎ Ⴏⴏ Ⴐⴐ Ⴑⴑ Ⴒⴒ Ⴓⴓ Ⴔⴔ",
  "Ⴕⴕ Ⴖⴖ Ⴗⴗ Ⴘⴘ Ⴙⴙ Ⴚⴚ Ⴛⴛ Ⴜⴜ Ⴝⴝ Ⴞⴞ Ⴟⴟ Ⴠⴠ",
  "Ⴡⴡ Ⴢⴢ Ⴣⴣ Ⴤⴤ Ⴥⴥ Ⴧⴧ Ⴭⴭ აᲐ ბᲑ გᲒ დᲓ ეᲔ",
  "ვᲕ ზᲖ თᲗ იᲘ კᲙ ლᲚ მᲛ ნᲜ ოᲝ პᲞ ჟᲟ რᲠ",
  "სᲡ ტᲢ უᲣ ფᲤ ქᲥ ღᲦ ყᲧ შᲨ ჩᲩ ცᲪ ძᲫ წᲬ",
  "ჭᲭ ხᲮ ჯᲯ ჰᲰ ჱᲱ ჲᲲ ჳᲳ ჴᲴ ჵᲵ ჶᲶ ჷᲷ ჸᲸ",
  "ჹᲹ ჺᲺ ჽᲽ ჾᲾ ჿᲿ Ꭰꭰ Ꭱꭱ Ꭲꭲ Ꭳꭳ Ꭴꭴ Ꭵꭵ Ꭶꭶ",
  "Ꭷꭷ Ꭸꭸ Ꭹꭹ Ꭺꭺ Ꭻꭻ Ꭼꭼ Ꭽꭽ Ꭾꭾ Ꭿꭿ Ꮀꮀ Ꮁꮁ Ꮂꮂ",
  "Ꮃꮃ Ꮄꮄ Ꮅꮅ Ꮆꮆ Ꮇꮇ Ꮈꮈ Ꮉꮉ Ꮊꮊ Ꮋꮋ Ꮌꮌ Ꮍꮍ Ꮎꮎ",
  "Ꮏꮏ Ꮐꮐ Ꮑꮑ Ꮒꮒ Ꮓꮓ Ꮔꮔ Ꮕꮕ Ꮖꮖ Ꮗꮗ Ꮘꮘ Ꮙꮙ Ꮚꮚ",
  "Ꮛꮛ Ꮜꮜ Ꮝꮝ Ꮞꮞ Ꮟꮟ Ꮠꮠ Ꮡꮡ Ꮢꮢ Ꮣꮣ Ꮤꮤ Ꮥꮥ Ꮦꮦ",
  "Ꮧꮧ Ꮨꮨ Ꮩꮩ Ꮪꮪ Ꮫꮫ Ꮬꮬ Ꮭꮭ Ꮮꮮ Ꮯꮯ Ꮰꮰ Ꮱꮱ Ꮲꮲ",
  "Ꮳꮳ Ꮴꮴ Ꮵꮵ Ꮶꮶ Ꮷꮷ Ꮸꮸ Ꮹꮹ Ꮺꮺ Ꮻꮻ Ꮼꮼ Ꮽꮽ Ꮾꮾ",
  "Ꮿꮿ Ᏸᏸ Ᏹᏹ Ᏺᏺ Ᏻᏻ Ᏼᏼ Ᏽᏽ ᲈꙊꙋ Ᲊᲊ ᵹꝽ ᵽⱣ ᶎꟆ",
  "Ḁḁ Ḃḃ Ḅḅ Ḇḇ Ḉḉ Ḋḋ Ḍḍ Ḏḏ Ḑḑ Ḓḓ Ḕḕ Ḗḗ",
  "Ḙḙ Ḛḛ Ḝḝ Ḟḟ Ḡḡ Ḣḣ Ḥḥ Ḧḧ Ḩḩ Ḫḫ Ḭḭ Ḯḯ",
  "Ḱḱ Ḳḳ Ḵḵ Ḷḷ Ḹḹ Ḻḻ Ḽḽ Ḿḿ Ṁṁ Ṃṃ Ṅṅ Ṇṇ",
  "Ṉṉ Ṋṋ Ṍṍ Ṏṏ Ṑṑ Ṓṓ Ṕṕ Ṗṗ Ṙṙ Ṛṛ Ṝṝ Ṟṟ",
  "Ṡṡẛ Ṣṣ Ṥṥ Ṧṧ Ṩṩ Ṫṫ Ṭṭ Ṯṯ Ṱṱ Ṳṳ Ṵṵ Ṷṷ",
  "Ṹṹ Ṻṻ Ṽṽ Ṿṿ Ẁẁ Ẃẃ Ẅẅ Ẇẇ Ẉẉ Ẋẋ Ẍẍ Ẏẏ",
  "Ẑẑ Ẓẓ Ẕẕ Ạạ Ảả Ấấ Ầầ Ẩẩ Ẫẫ Ậậ Ắắ Ằằ",
  "Ẳẳ Ẵẵ Ặặ Ẹẹ Ẻẻ Ẽẽ Ếế Ềề Ểể Ễễ Ệệ Ỉỉ",
  "Ịị Ọọ Ỏỏ Ốố Ồồ Ổổ Ỗỗ Ộộ Ớớ Ờờ Ởở Ỡỡ",
  "Ợợ Ụụ Ủủ Ứứ Ừừ Ửử Ữữ Ựự Ỳỳ Ỵỵ Ỷỷ Ỹỹ",
  "Ỻỻ Ỽỽ Ỿỿ ἀἈ ἁἉ ἂἊ ἃἋ ἄἌ ἅἍ ἆἎ ἇἏ ἐἘ",
  "ἑἙ ἒἚ ἓἛ ἔἜ ἕἝ ἠἨ ἡἩ ἢἪ ἣἫ ἤἬ ἥἭ ἦἮ",
  "ἧἯ ἰἸ ἱἹ ἲἺ ἳἻ ἴἼ ἵἽ ἶἾ ἷἿ ὀὈ ὁὉ ὂὊ",
  "ὃὋ ὄὌ ὅὍ ὑὙ ὓὛ ὕὝ ὗὟ ὠὨ ὡὩ ὢὪ ὣὫ ὤὬ",
  "ὥὭ ὦὮ ὧὯ ὰᾺ άΆ ὲῈ έΈ ὴῊ ήΉ ὶῚ ίΊ ὸῸ",
  "όΌ ὺῪ ύΎ ὼῺ ώΏ ᾰᾸ ᾱᾹ ῐῘ ῑῙ ῠῨ ῡῩ ῥῬ",
  "Ⅎⅎ Ⅰⅰ Ⅱⅱ Ⅲⅲ Ⅳⅳ Ⅴⅴ Ⅵⅵ Ⅶⅶ Ⅷⅷ Ⅸⅸ Ⅹⅹ Ⅺⅺ",
  "Ⅻⅻ Ⅼⅼ Ⅽⅽ Ⅾⅾ Ⅿⅿ Ↄↄ Ⓐⓐ Ⓑⓑ Ⓒⓒ Ⓓⓓ Ⓔⓔ Ⓕⓕ",
  "Ⓖⓖ Ⓗⓗ Ⓘⓘ Ⓙⓙ Ⓚⓚ Ⓛⓛ Ⓜⓜ Ⓝⓝ Ⓞⓞ Ⓟⓟ Ⓠⓠ Ⓡⓡ",
  "Ⓢⓢ Ⓣⓣ Ⓤⓤ Ⓥⓥ Ⓦⓦ Ⓧⓧ Ⓨⓨ Ⓩⓩ Ⰰⰰ Ⰱⰱ Ⰲⰲ Ⰳⰳ",
  "Ⰴⰴ Ⰵⰵ Ⰶⰶ Ⰷⰷ Ⰸⰸ Ⰹⰹ Ⰺⰺ Ⰻⰻ Ⰼⰼ Ⰽⰽ Ⰾⰾ Ⰿⰿ",
  "Ⱀⱀ Ⱁⱁ Ⱂⱂ Ⱃⱃ Ⱄⱄ Ⱅⱅ Ⱆⱆ Ⱇⱇ Ⱈⱈ Ⱉⱉ Ⱊⱊ Ⱋⱋ",
  "Ⱌⱌ Ⱍⱍ Ⱎⱎ Ⱏⱏ Ⱐⱐ Ⱑⱑ Ⱒⱒ Ⱓⱓ Ⱔⱔ Ⱕⱕ Ⱖⱖ Ⱗⱗ",
  "Ⱘⱘ Ⱙⱙ Ⱚⱚ Ⱛⱛ Ⱜⱜ Ⱝⱝ Ⱞⱞ Ⱟⱟ Ⱡⱡ Ⱨⱨ Ⱪⱪ Ⱬⱬ",
  "Ⱳⱳ Ⱶⱶ Ⲁⲁ Ⲃⲃ Ⲅⲅ Ⲇⲇ Ⲉⲉ Ⲋⲋ Ⲍⲍ Ⲏⲏ Ⲑⲑ Ⲓⲓ",
  "Ⲕⲕ Ⲗⲗ Ⲙⲙ Ⲛⲛ Ⲝⲝ Ⲟⲟ Ⲡⲡ Ⲣⲣ Ⲥⲥ Ⲧⲧ Ⲩⲩ Ⲫⲫ",
  "Ⲭⲭ Ⲯⲯ Ⲱⲱ Ⲳⲳ Ⲵⲵ Ⲷⲷ Ⲹⲹ Ⲻⲻ Ⲽⲽ Ⲿⲿ Ⳁⳁ Ⳃⳃ",
  "Ⳅⳅ Ⳇⳇ Ⳉⳉ Ⳋⳋ Ⳍⳍ Ⳏⳏ Ⳑⳑ Ⳓⳓ Ⳕⳕ Ⳗⳗ Ⳙⳙ Ⳛⳛ",
  "Ⳝⳝ Ⳟⳟ Ⳡⳡ Ⳣⳣ Ⳬⳬ Ⳮⳮ Ⳳⳳ Ꙁꙁ Ꙃꙃ Ꙅꙅ Ꙇꙇ Ꙉꙉ",
  "Ꙍꙍ Ꙏꙏ Ꙑꙑ Ꙓꙓ Ꙕꙕ Ꙗꙗ Ꙙꙙ Ꙛꙛ Ꙝꙝ Ꙟꙟ Ꙡꙡ Ꙣꙣ",
  "Ꙥꙥ Ꙧꙧ Ꙩꙩ Ꙫꙫ Ꙭꙭ Ꚁꚁ Ꚃꚃ Ꚅꚅ Ꚇꚇ Ꚉꚉ Ꚋꚋ Ꚍꚍ",
  "Ꚏꚏ Ꚑꚑ Ꚓꚓ Ꚕꚕ Ꚗꚗ Ꚙꚙ Ꚛꚛ Ꜣꜣ Ꜥꜥ Ꜧꜧ Ꜩꜩ Ꜫꜫ",
  "Ꜭꜭ Ꜯꜯ Ꜳꜳ Ꜵꜵ Ꜷꜷ Ꜹꜹ Ꜻꜻ Ꜽꜽ Ꜿꜿ Ꝁꝁ Ꝃꝃ Ꝅꝅ",
  "Ꝇꝇ Ꝉꝉ Ꝋꝋ Ꝍꝍ Ꝏꝏ Ꝑꝑ Ꝓꝓ Ꝕꝕ Ꝗꝗ Ꝙꝙ Ꝛꝛ Ꝝꝝ",
  "Ꝟꝟ Ꝡꝡ Ꝣꝣ Ꝥꝥ Ꝧꝧ Ꝩꝩ Ꝫꝫ Ꝭꝭ Ꝯꝯ Ꝺꝺ Ꝼꝼ Ꝿꝿ",
  "Ꞁꞁ Ꞃꞃ Ꞅꞅ Ꞇꞇ Ꞌꞌ Ꞑꞑ Ꞓꞓ ꞔꟄ Ꞗꞗ Ꞙꞙ Ꞛꞛ Ꞝꞝ",
  "Ꞟꞟ Ꞡꞡ Ꞣꞣ Ꞥꞥ Ꞧꞧ Ꞩꞩ Ꭓꭓ Ꞵꞵ Ꞷꞷ Ꞹꞹ Ꞻꞻ Ꞽꞽ",
  "Ꞿꞿ Ꟁꟁ Ꟃꟃ Ꟈꟈ Ꟊꟊ Ꟍꟍ ꟎꟏ Ꟑꟑ ꟒ꟓ ꟔ꟕ Ꟗꟗ Ꟙꟙ",
  "Ꟛꟛ Ꟶꟶ Ａａ Ｂｂ Ｃｃ Ｄｄ Ｅｅ Ｆｆ Ｇｇ Ｈｈ Ｉｉ Ｊｊ",
  "Ｋｋ Ｌｌ Ｍｍ Ｎｎ Ｏｏ Ｐｐ Ｑｑ Ｒｒ Ｓｓ Ｔｔ Ｕｕ Ｖｖ",
  "Ｗｗ Ｘｘ Ｙｙ Ｚｚ"
].join(" ");

/**
 * The GLOB metacharacters. `^` is deliberately absent: it is only special
 * *first inside a class*, and emitting a literal `^` as the single-member class
 * `[^]` silently negates the class — measured on SQLite 3.51.3,
 * `'a^b' GLOB '*[^]*'` is 0 while `'a^b' GLOB '*^*'` is 1. Same for `]` and
 * `-`, which are literal outside a class. So the rule is: emit a class only for
 * a real multi-member fold group, and escape only these three.
 */
const GLOB_METACHARACTERS: ReadonlySet<string> = new Set(["*", "?", "["]);

/**
 * The result of translating a `like` pattern.
 *
 * `never` is not a detail to skip: a pattern ending in a lone `\` can never
 * match anything (the in-memory rule emits `(?!)` for it), and `GLOB` has no
 * way to express that. A caller must compile it to a false condition — and for
 * a negated operator, must still apply the field-presence check separately,
 * because "the field is absent" is not the same as "the pattern did not match".
 */
export type LikeGlobPattern =
  | { readonly kind: "glob"; readonly pattern: string }
  | { readonly kind: "never" };

let caseFoldMembers: Map<string, string> | undefined;

/**
 * Each BMP character that shares a case-fold group with at least one other,
 * mapped to the full group — i.e. the class body to emit for it.
 *
 * Exported so the regeneration test can compare the embedded table against one
 * it builds from the running engine, rather than trusting a hand copy.
 */
export function likeGlobCaseFoldGroups(): ReadonlyMap<string, string> {
  if (caseFoldMembers === undefined) {
    caseFoldMembers = new Map();
    for (const group of CASE_FOLD_GROUPS.split(" ")) {
      for (const member of group) {
        caseFoldMembers.set(member, group);
      }
    }
  }
  return caseFoldMembers;
}

/**
 * Translates a `like` pattern into an equivalent `GLOB` pattern.
 *
 * Iterates UTF-16 **code units**, not code points, because `likePatternRegex`
 * does (`pattern[index]`) and the two must agree exactly. That is also why
 * nothing outside the BMP is case-folded on either side: a surrogate is its own
 * fold group, so a surrogate pair passes through as the pair it is.
 *
 * The returned pattern can be up to 6x the input's UTF-8 byte length (`Т` ->
 * `[Ттᲄᲅ]`, 2 bytes -> 12), and SQLite raises "LIKE or GLOB pattern too
 * complex" past `SQLITE_MAX_LIKE_PATTERN_LENGTH` — measured at 50000 bytes. A
 * caller binding this into SQL must bound it; see
 * `D1_PROJECTION_TEXT_PATTERN_MAX_BYTES`.
 */
export function likeGlobPattern(pattern: string): LikeGlobPattern {
  const groups = likeGlobCaseFoldGroups();
  let glob = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      const next = pattern[index + 1];
      if (next === undefined) {
        // A trailing lone `\` escapes nothing and the in-memory rule compiles it
        // to `(?!)`. Treating it as "escapes nothing" would match, which is the
        // opposite of the rule.
        return { kind: "never" };
      }
      glob += globLiteral(next, groups);
      index += 1;
      continue;
    }
    if (char === "%") {
      glob += "*";
      continue;
    }
    if (char === "_") {
      glob += "?";
      continue;
    }
    glob += globLiteral(char ?? "", groups);
  }
  return { kind: "glob", pattern: glob };
}

function globLiteral(char: string, groups: ReadonlyMap<string, string>): string {
  const group = groups.get(char);
  if (group !== undefined) {
    // No multi-member group contains `* ? [ ] ^ -`, so members never need
    // escaping inside the class and their order cannot form a range. A test
    // asserts that, because the whole scheme collapses without it.
    return `[${group}]`;
  }
  return GLOB_METACHARACTERS.has(char) ? `[${char}]` : char;
}
