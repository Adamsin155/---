// The site's service worker, at the root so its scope covers clients.html (and
// every page). Three jobs and nothing else:
//  0. The site's own files (the pages, scripts, styles, fonts and icons: exactly the
//     list the publish wrote into BUILD below) are kept on the device and answered
//     from there, so a screen opens without waiting for the network (docs/ops.md,
//     section 42). Nothing else is ever stored or answered: a request to another
//     host (the database, the functions, the client's files) is not touched at all,
//     and neither is anything that is not a GET of a listed file. In the repository
//     BUILD is null and this part is off: pages load from the network as before.
//  1. Web Push from the reminder engine (supabase/functions/reminders): each push
//     is JSON { title, body, url, tag } and is always shown (iOS requires it).
//     The tag is the case (pushTag in app/reminder-engine.js), and `renotify` comes
//     with it: the next step of the same case, a repeat of a task given on the spot
//     or the next batch of lateness notes replaces the notification before it and
//     still sounds, so many pushes are few banners.
//  2. Notifications a page shows itself through this registration (the "now" bar
//     on Chrome for Android, where only a service worker may show one).
// A tap opens the page the notification is about, on this site only, or brings
// forward the window already on it. app/push.js registers it (siteWorker()).
const HOME = 'clients.html#mine';

self.addEventListener('install', () => self.skipWaiting());

// ── The site's files, kept on the device ──
// scripts/build-pages.mjs replaces the next line at publish with
// { version, files: { '<path>': '<sha-256 of the file, hex>' } }: every published file.
const BUILD = {"version":"b0af2b2820a2514b","files":{"access.html":"925bade00174f5809b79c1bcbb874be2bc0eda5b3911c25b38fa4ffa20e89444","app/access-data.js":"3fe9ecf8bd36c04e71fe33b949649fb5f97966c68c6bdc0a13da7ecf553813cc","app/access-form.js":"a76b118001574aaf62610ae7cc86764aef2b17c207cb9a181e98f42217b73248","app/access-link-ui.js":"8710222a349bfed486b9cd675f7588ae0fd9653e61318e48d5d8121efdf2cf85","app/access-logic.js":"c3b2599edf933c6baa8296e0e8641c4b7eec55dbe1a7960893afab8de15ee147","app/access-nudge.js":"1591ad693817b357068ce891bcead9fa043175c2f95868487b1b0a584d4b3f1a","app/approvals-logic.js":"9a79515750c19c85557482995ff00baafa1f8f4def50ba7912f0f225d17ecdc9","app/approvals-ui.js":"7a6e66cc8b99b22f65f02cc5277fff19b8e1559f1d953375d023caa4a109e50b","app/assets/logo-mark.png":"2cd2f349d456cb9b3ec6296cd9f069f1ffe65d1bcacceff8c878067d812954a4","app/assets/logo.png":"f3449f67c8e000b64f4b70e4e1f4d416b3461f5bac4b3c8bc4bfd281cff826c3","app/auto-assign.js":"4f81af99bd039c217a7a348022fdb045595deeeb3321dc8b2c41625e17340ee1","app/availability-logic.js":"1923d38721d0fb5ecb61c560b536a47eb8948ed3bc75435fddbc1404a0dc2f91","app/availability-ui.js":"b5aed00e04d57162e329eca9c74d949552e23b904feb96b1c163c49e34266a54","app/briefs.js":"84d702fcfa7640ef1152dba3009a3720e0bc89c888ef5f9d30648b6803a44c88","app/builder.js":"3b8f453101f12bbcbab88548a5ae10c04b380607b629d70f6e49b79b993ceadb","app/calendar-card.js":"df0915780ec8d93fb45735960f270adefc5ee165bc0e7365824a2f750b650344","app/calendar-feed.js":"6994014d76317caa45cdb38024f0489b46db7e5c93f71c15f637eff066d74f74","app/calendar-page.js":"5d6c4f17027cf7512e83ef269ca406e5d49f0fcfe62a0e0c2d285f20cf386d84","app/calendar-view.js":"5ac01307e5bb1a8a5d544adc43567f10833c7380d1538c5c1ecdfecec8e582d2","app/calendar.js":"a3d90813076a9bbada79b19b1a58d1ceea3db780778c274edd967d48335a6756","app/card-metricool.js":"68c85445c643ad377bad18cae0e7d3ab3fcdac25a47f9e2455bb6183ee0d955c","app/catalog.js":"f3f84fab12be0e9bd272798205918b1bf7d29815cc3de7c679249538e5edf5c1","app/characterization.js":"2418c599e07dc5203c6cb76c2d1430a8d9411a25e10f5b35f1f4c2d63cbb4415","app/client-card.js":"de23441d423e7ccfb7cccd00643d6ea159b99c856d282b503340ba9f78c99a8d","app/client-links.js":"3b0b9d9f37fcde761e125f8789ae5a685da13e477b16863528f59481608ae035","app/client-open.js":"6303eecfb0153ec430dbbaf88cd60d3b56448db4086c33d7d3420c4cfa52ff40","app/client-waits.js":"26e40be97dd7fae399b3d4457f05da772f1ec42ccacd966ddbb8bdba0c91ebf7","app/client.js":"4a46735b73393cfa00a93cd83546068b94ad444019c97bd650a49ac2d5644cc1","app/clients.js":"2b933698acdafde5beb3570f4cffccb9e8e2797fb18119265d35723b800fe454","app/clocks.js":"015f79f6d3e8e1b69548b4875419c172e8b74e0af19a6b8d9223c46710ba11df","app/contract-ai-logic.js":"09d046b35f9ac5c205d670e1a2a24faf0a109730dd0e9326171b2db77594abd1","app/contract-end-ui.js":"d98df7952bae2974b3f93d4e8558699533a66bef04c6319f06c7b9210a3ebc37","app/contract-end.js":"b66cecd558d1d652468a99a3c95a2845e02fca302ff636921fea1bac165ac10b","app/contract-summary.js":"3c60c582f369edc1b75c5e4f555eb1d669d1187ca968786d914e0b29bea0327f","app/control-topics.js":"abfb01c412a5ee3afaa809a18f51ae7c2f5434ba0466a46c4a7f73a41004e2e4","app/dashboard.js":"607eb4f46bba1de2d55f79deb3e34770c978a515af2f5345fa29712d7f76d9cb","app/data-cache.js":"c7445ec7cf40620df76970c217259f2069d9421cf4cbaf9c9d05128441a8dffe","app/date-set.js":"37efe2a328c8b8ab444e9fcaa331018dd4ab4f5aae99a70ab2b6e7a3bd7636e3","app/day-summary.js":"0d24e7ee320e4ae6fc6025b56e45aec48ffec3ec304740d8ab5247a4311abb53","app/deal-data.js":"5f073e8cb070eb5eee1a8181c59e8472778ec6389002dddb5a89a0d9a22534bf","app/deal-logic.js":"e3de454adc1d7fb2770ae695779b1ef7337d21020fa8bf12daa6265526306573","app/deal-ui.js":"2eb541a8531c558bb9ad44ecacd4c9161a52b887bf86f862117c378897b866ec","app/deal.js":"c2c4e8cd3462a6231690c38bd33e45b850c11bcde01c4a721c23e5041efd4809","app/decisions-logic.js":"bb62314cd87808dba544a9d454bb56465dbe062ccc5b08b34e3ae5a6e0992626","app/decisions.js":"978267522170eaf6f54e83f90466e93a19e364e92e612db37ecba0902de25d4b","app/edit-count.js":"2dad82a67316bd3441c8021a4d6f83a6a16e2b82316f6a988d4a5d013b62ca0f","app/editor.js":"4b0772de6ec6dbe41efaca28e574044a74976c7daccdeca76ed726f018fb9aa2","app/fast-ladder.js":"e0513fdf9538222d012ad57cc0c8dc7587c8dcaa678937e7f5a7f0f45eba07d8","app/feel.js":"59e125c5ec2091ad8745c03d9483be37d259eaf865a897218b02da546c9534da","app/files-logic.js":"331fec12bd85f6b77955c5e1a170aa4602dad3816ee8f33947784056679e1326","app/files-ui.js":"30ffd8df014939ad113228ef544314b00342f0a0d1c2994e71c9b68e388c731a","app/fix-request-ui.js":"237abeb2bfe053807e3ba66285184dcc667792c67961fa1c8f2de78a329a090c","app/fix-request.js":"f949d7353fb9b739491334a8390da73431437fdd607cf10be48570437ac3a970","app/fonts/OFL.txt":"5163e9f9fda30f27c95700c375293baaf841afc890d8a8496113bc954a19ab7f","app/fonts/fonts.css":"84aa1405bf6ad2b9254f23e2afbe389d852308c8c4d8305fa97e9be4d28e2236","app/fonts/heebo-hebrew.woff2":"f1f7cfaef59431c7b391df81fb05520273303840bbe917213a2ab9f41b839675","app/fonts/heebo-latin.woff2":"50dae2e12dae22c920388023e35aaebcd1e1d27bbe915c83d64210377e083e60","app/fonts/jetbrains-mono-latin.woff2":"18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e","app/fonts/rubik-hebrew.woff2":"197b6dbe5c6bec7276c59b02d70a16ee6acd44322fc2f8d0226c07f8d57976c2","app/fonts/rubik-latin.woff2":"691cd1d9b4c0cdf31a1dcf04259c86f92c85e69f6622abab7964d81e36890691","app/fonts/varela-round-hebrew.woff2":"61f49780c3763145a924f538636d2e4aa190d614ea44a190758260896e4d804d","app/fonts/varela-round-latin.woff2":"03871f86c86fc776f89d0cb947502f3957181b63327fecaec724bc39d082319f","app/frame-guard.js":"b6e68dfdeab0aefbd99ae86d6138a4a99fc3e23eefba5cffd373732718a063c9","app/gallery.js":"a1f6ac4cc72ac8abc5a5aa51c7b7e91410a62fee337c535219c200ef98111476","app/gantt-brand.js":"fc1feca683270973a018306fb84d322ecdf28931eab2ef5d1f91bbc1dd11bce9","app/gantt-data.js":"8bed740098566afd9564fbabecba9f580a72f192180539f94f5ef6bacf57fdf2","app/gantt-index.js":"29b882fb3aecc70bd6b8db838ee4c910bdf745b63ebff2b137be7c288b50fb2f","app/gantt-logic.js":"d5d16c330e1f035269ef87bfe6a9b706f57ef60c9736e7170fc1b8de8a7a1925","app/gantt-template.js":"d64560bce00d1a4de816b99f839f07d6e7c9108ea77218ff5240a41a51d1eeed","app/gantt.js":"0ef2c3820b4841f33dbcccb6d9eb8aeaa3430b1af0190c92d95174ad1e0d6e2b","app/gcal-logic.js":"b594cce0088c8f732b81e2bd7b9580ccd1029c2695e8f9c21ba93f7d020b706e","app/gcal-page.js":"dc6fc1bff79e5937052fc17afdd96a906f14551eb8e449d6b6eb4ab2e66cd998","app/handoff-ui.js":"3cd85b5165b7db50ce8e3a2a751d4894085ace53923adc0a8fe12b3895982aec","app/handoffs.js":"7f6ba5313af5fbb6c5606f37c6184715a2ccf93e37345d2c5485db10b80c65da","app/health-ui.js":"114b88330f76f0d8d2ef6dd949428129dd069a6801ae84e07fb4578437428177","app/health.js":"50ea34b9552862eb1def703c0e4ea910112677fe88c4c256c6f20ac9663412ed","app/holidays.js":"abf016950aad8ec6044f8b59e21bf1865acb6c6cbffd5bfe38e8101935d75592","app/ics.js":"7dbc44707f531580f05eef0e5351e924c09e6f14b8488bc855b8d619f33d7c8f","app/ilai-card.js":"89646482b2e06eedcc30f66b0359578e019235cc730d7c947016dd17d8532d18","app/ilai-logic.js":"53bccce6c4ae6d973012469af2d20e2fddf6c580f7a02acfdb06025b79ad665a","app/insights-page.js":"35dd2b403fba97a2e9860a9411b67493311240f6f123af3a9fc5500435a4cd5c","app/insights.js":"099501997756bc1c8878153ff25195da3c8717f5bffb154cedd5452efa446370","app/intake-data.js":"77da50026e126f8c0fc46e874b57ce516fb99c32b2ea976751cfaa4fe3edb3cf","app/intake-ui.js":"9b33cd68f4a80fd38ae80c5a71cf23012a99d7e3c74332c9ca09ff1a85389989","app/intake.js":"df6d2ca4d86a92efb2c169b01abebfd1206d707c5e4cbf242b9328185f655acb","app/kit.js":"f23a96f50d5c335b118b360a49e994686bc88711391e59791d0f7e07d9909681","app/landing-control.js":"d0f8b07d3fd31b251d4ddb3aea6a35e8c9f3870fb09541bea8c6f1bd7785c196","app/landing-data.js":"dcd905ed8163657aae6a461427fe25fec08cce72d81925be65a600cf22afa8a6","app/landing-link.js":"b3c35c84126c0a695aae027728057a8b6ebdc1193eeb69771418d1528a55cd47","app/landing-logic.js":"c716683e22ff6d2f1613ec4ecaa86d3da922570de7bba5a6afe490d6881dec5a","app/landing-ui.js":"7b039fb6188f415220f250c29df757291c04f337c12aedb2c3ed12733bf48751","app/late-chain.js":"19c8e589b4ffeff7cbc10554081a62d2c96a9a9402d800a795dcc4a1b301dfac","app/legacy-contract-logic.js":"6b9ce24c8e7ca89287ca76f1871fcc589b30475774c38d4e2daccb890ef58a2f","app/legacy-contract.js":"ac5f131e67ad4ee29391ac382cc57c1f9bc551b756cd1363ba7731d076a76ae7","app/legacy-contracts-data.js":"491f9bc2d7c7f21ed6c349ce18d9dbc7227f0e4a5940b3c5b4c795d1e10578f8","app/legal.js":"07ab7703a28952c4b64d4116332279303a3b22991f68c999092629acdbf63be1","app/link-token.js":"4c7071749b1b38c57d7915fa3dc1f2f887080f74a9ffeb5f7b50076b5bf6aa62","app/login-gate.js":"a6ebfb294aad632130bf467d6a8818c653e156ddd185eebde6ec7041dffb730c","app/login-ui.js":"b8f309f41bd2bf79907903ac152e281ce93cfc340fe9d1f70ec3a2e2ef0916a3","app/manager-data.js":"85597fd7742480743c6e82fee52684968d53197b69821fa41ef8f2fcbf2c0147","app/manager-rules.js":"bf1642c30cdeeaeb6a339a8517c493fdcc1f686f8005e44f2799947332e4a93d","app/manager-table.js":"d1ac247ca8c69035f3f9b12a5c092aaab125fc875218fccb5a571dcaa5497f29","app/mark-guards.js":"c9947482fd192a9623487e2c95686a141df282d893efd1d40fbbc377e17e1236","app/messages-logic.js":"938f5949ecaaccd3c70c716913663fe7d32542887dd6dfb187b7c37ddcabeb46","app/messages.js":"e2ba999a9b0969d7a5d6cdb72c43877fb4667917ed484712df36fe880d21c60f","app/metricool-connect-logic.js":"d9c2b6918b835aa7d859c1453a350e948c72192a1aded918216dcb6f7b4cbc1c","app/metricool-connect-ui.js":"00fd035ddc1309ae2f158ee7d242b66a7b0a18c0185a01d771cb8435faafef1b","app/metricool-logic.js":"ff25c2c09a1857f9698a55b560272fdf66fa12770ca5ca9486a9031e2b6a4d50","app/metricool-team.js":"976c84ccb7087ee84c61fae2fc146c075c0c525cd2957bcac83ca5252719f2e4","app/mine-flow-data.js":"b3d4782660a54d68d4219e7f53acebfc7d7dbbc0103765ad988ff02a971cd16c","app/mine-flow.js":"40e86115bde2a2bd293aa7b1e94c211b63660223148f76dbc07057f30666e2eb","app/mine-metricool.js":"b4c1303a5d217c39399c962c8974d3dd7965a6864cb118296cda9fec2123f226","app/month-ui.js":"36d610a359334146f206c1a3d2514ba671c58633491e6ddd7681b4f60cad777f","app/new-meeting-logic.js":"06614bac968cf01020e141add4ebe4d61b999efd48b62dd6e68dcf5c255cf091","app/new-meeting.js":"0928cc436df7b675563910786adc442dfb59af855778e6f792752e87a304c161","app/now-bar.js":"f6efa99df522793dadfe41f28ac660cc8295c130787da13e082dbec4d60322a8","app/office-data.js":"154b2cfbd2e87e450176267bca6abcb788d412677c865f1be3175ab2a926a839","app/office-marks.js":"67c10fec19f10fb76e969d9260f1660ad128a5c90f0d65706347158e046b7372","app/office-ui.js":"588356415a1025aa85c52849324b32db3dac9896d88afdf06670e59cd24365e4","app/owner-data.js":"0348c0d304511a8ed3b2c2ab761e8fbf2ef81a079084f21b619409b2c1c60fa0","app/owner.js":"112df923fba52366ca3978dba7b099f36787bf0d787abc4c8072da6bca3ef2f0","app/pass-logic.js":"09f359e10ccaad1cef95d4053846ac81a6c17304decce4241cb71b72f4a1c07c","app/pass.js":"a829a9573a83ecca2439f23264d58946d776cbd6643853493042f57c496a94d6","app/payouts/app.js":"6d4e2f3dd8538d52f75a5954528563610e3f918c583d0d6c1f9e3a3edd0c2fbb","app/payouts/client.js":"0931a4786e8a712694137ceb2b6031366818ae6d4efb64768b4217d355b20ed5","app/payouts/data.js":"0a7767abdd3eed3772571679b435ce4b827c451b66fa5e30c1ebc24343e7b6fd","app/payouts/door.js":"532ea19714e99897c7eb57fcd1a181932e05d89496f482cf6be0c846ca8ec03e","app/payouts/engine.js":"ad944d1ca1732122913bc277feb77491f893f37a8634b5a98ae8752a4e4fa09f","app/payouts/gate.js":"5409be7ed9a7d3d6147066a0ef0ae3a12dc7a91831207830f79be140ea53d5de","app/prep.js":"a95120eb511f4bd95000ab3270ad3d22529fc6edd1ca509dba8e0745b4aff4b7","app/pricing.js":"2b63a0beb2149899db2de51cac8309ceb5b0742b9d8abaf55ac102a4eb34fdc7","app/production-data.js":"9a90da9be46004762dd4b270da162dac4e7a97a1d39ee98e44814314d133d70c","app/production.js":"7a7dd5fdad0df98bff6c99a4556c81e1e8ad5686b2f2502ebc7a3ea9c5022cb6","app/protocol-data.js":"c3742d738e96d7eaf5d960d34658cb2625c604526896ee1a027789f3742f9f5d","app/protocol-logic.js":"7be732dc1ebec975ad5f7059325f3592ad5d701c2d32d36bf8ccd7972511a864","app/protocol-ui.js":"1267de4e68198319c7db4187a78623e7457ed663506bb7e6ab26d2937ab59035","app/protocol-versions.js":"00acfc3c8aa1f40390c656b2d41d68c8834d586ee2e52af6471e4be83f79424d","app/protocol.js":"978f748f318e874b2aea909caefdc8a3cd9bd149c6dfd31b9ffb5845327d88c9","app/push-config.js":"b8fbb7f69ec84dea60a1bcdb43a59dfa69ce61e389b61c600214b53ae78f4d55","app/push-logic.js":"c471ff3938328e0127aa1bbc5211c58bab16ae8d2b3b75068d80e5f92f16e254","app/push.js":"29a62068f9915586b24ddfee9cd8d1221b0f8a3b117dec7caabe58448c4322cc","app/qa-logic.js":"bc155591f006259ccac7bec1dc086549e36831cdd603ae9aba3ee10ca8c2a94e","app/qa.js":"f8573b85061ba997860fd41fa03d53cf70db8e209864aa22f27b4346f558fe97","app/questions-ui.js":"2b72df41eb8da6a91250932eebc7a7afdaba480d2952a12f6be5240f15842be6","app/quote-doc.js":"5fc86fc5a5bd6aa5fcfeaf9ad83551759eecb93669fbddc4abe4b4a725811e6f","app/reminder-engine.js":"1353e1424d9afed966acf39fac4ad799b9eeb6732b3975b6edf263286a238988","app/reminder-rules.js":"ee3ee8f0177af0bee276cb338e6e06adf56510ce068c55140bb195538dcc8428","app/renewals.js":"3172f3da40d75b90bdde10bce80de32ed99e7d9c063147642f58a47dc5366ef0","app/scripts-data.js":"3f1ee05eb7eb630f0371273b581064c4470b01b70816b5d037b4b2ffceeecab8","app/scripts-logic.js":"e7a56a59654c9ee049a92ca0398c875708a4f68aaa74755e0a78d9fe12383a4f","app/scripts-view.js":"71fc4e1f78ed92fa290ab16f1b2fdfcd55ac68897b31344a26e7a46273db8052","app/scripts.js":"ff35c9a19d1834b4425b85bae7bc158ea795ceff884b9b7794400266e04d926a","app/session-store.js":"99c2e24b015e8d59fb087d0f9871499cfe89784ab9e69ff87a179c76e631267f","app/set-password.js":"6c8ec25c4dd1ce3acf67984e175f2b2e18a16de1f9164adf85513a78317a0747","app/shell-gate.js":"55fc49602d0f14cc45be95e879903f0393d52a87830c4157bf4415cdfd7be46d","app/shell-rules.js":"f8f85341bdb7e95b693bf110235d3301ead188be9060215a233d05c4309551c2","app/shell-state.js":"40b537c963bac00391d9dc527601599c9e09fbd0e8bb37aee2072edcc7108687","app/shell.js":"19acc78a87cf5b0f0542d78116bb5e5f7f0a354fea709ec84893e60b3088c123","app/shoot-prep.js":"a7e312ae877385f75dc81a7b1a10c64f5d209b089258ee44b337bedf2fa34911","app/shoot-table.js":"be2c2fce44bc8eb0773f8ab726f1844261c3fa5c572ed884813acf579ee9e534","app/shoot.js":"f093f86dde350f6363afc2b8e2a4349073734d46f09e1d56e0e95e3cb675b1b1","app/staff-tasks-logic.js":"b25e0c72789ead8bad2e5ea49d041caf8ba70c31669b9e2d755ec8423a4b5b27","app/staff-tasks-ui.js":"b66dc99b4b45c876bdc7b779494197ccb40558ee1b042ef2691197c7233117d4","app/status-link-ui.js":"66feb7ff6d395fcfee2577b5caaa0b6b5a1e99e1f70676cd7a04b5b0da94a2b2","app/status-logic.js":"4c0280003799d031780d18e1c485f9e6eb6e45cf7e1903b4916daf7f2a14ccc0","app/status-rules.js":"dfdb5f1b56427daddc776827088a24b109ef4cc3357375c28726be0c9ae2fbc5","app/status.js":"2f279845c0316b59416bc3baa544a6d61af1036958868b91ed69c3777e9b0023","app/styles/access.css":"3562d531d946a6f206e58aeaca838213fe52e345c99935675e1f381b001deab6","app/styles/app.css":"5d66912b5781c53dac4cbcbcf00fa89e261cb86acda99b2da1c165eecdb743c1","app/styles/approvals.css":"a69b238314c15edd7586b6412d265d3cc20a39b206af5927a4528134c70e61fa","app/styles/availability.css":"ecb194f7fcaaf6b6e3adae244d26828e7b02b9700c59d7a3d212cf5c8563bae7","app/styles/calendar-page.css":"c8d03fe5c62bb927c0385284d385ea82741a0fb6c88dfa04060d4ac8c7996d24","app/styles/calendar.css":"35b5240dfffb5d17b57aba3ea31368ec1dbeef97908782c3d75884cb14c68e93","app/styles/client-card.css":"7e71d112a58211af6fe61f99c7e2eab0cfdfe568bb3e073ba77dca5f8c2cedcd","app/styles/client.css":"738c74dd9b66df69264ea22b5309e800fa58ee20739bd139845a8d7bbbd5f7e5","app/styles/deal.css":"afcec6a92c429134a703b38eb9d9afd3759275cc3f2095a3effc1ee1d1f36723","app/styles/files.css":"60c84c02e30903b6b3505ec9c9a83bda20b4658d6756ee22bf322d93f1e781c3","app/styles/gallery.css":"119febf95008237ac6fed746aaaf235f4e6ca09b13e17c1dd9f9366298f0d126","app/styles/gantt.css":"723fa061de51a49d4a97cc69a4f6aa128e5fa90b1b774962bfb4383fb8c640c3","app/styles/gcal.css":"d1b71b20244bb1ec2cb617328f75062b0103013e21b32361cc916832936737a0","app/styles/insights.css":"a2c72392f0ce707861c9b0d852a1b9d00414f764f11623d6a8d60075002aeff6","app/styles/intake.css":"7f31243264381ac3f8889892e1ed8c99ccac0326f2579f70ea5d79e50cd8864b","app/styles/kit.css":"c74262bb54dc10d71390993ea4edfe699c439e92b1f67f2a3ed5a2cb28b493b5","app/styles/landing.css":"c66a09dbdd518f46786635e057ecef0c948746ce5788ebad564bd371a4079d53","app/styles/legacy-contract.css":"7b6495da091bc2c10ee8a73f311be8dd1dbc3f81a40b472681d59204a831dfec","app/styles/login.css":"a2e4875337a6e8c6120421485a4cdbe7b1be647ba0545822f290ba7650f930f1","app/styles/manager.css":"a88f988be4f76e0d77e0652f90a09df1d27e6eb15dbb3c7fec73efbe1e62ce0c","app/styles/messages.css":"b03b368e59ea379fc578fa4627e5433b4f9db50ed8a6d63d8269657dcb7d0d84","app/styles/metricool-connect.css":"1ae0a0861a263a2ea636c6a522108a27d0ec1ccb06c57e1b0ec4b10724a31563","app/styles/nav.css":"5082a6fd68530185c4cd82244f53c2f61ed7fe6a61bf50219b67d2a8a63d0154","app/styles/office-flows.css":"f30884fbd2e10899a039a53f0003bc0ac184b8d36e08fbaa710bb9129bf1ae9e","app/styles/owner.css":"162849f3ad1ccda5cfd492a1205086856cb5d2531dad201b397e9f16f3e2bbf3","app/styles/payouts.css":"c813b271cbb3d3f0e8f920caa5cef065fae90a68f91e303619133653e209c3de","app/styles/production.css":"a227ac893ee64ed64d9c0643835f8a510df44becab3812cffc3e37f0f968a170","app/styles/protocol-now.css":"7eef1b506d2474331a5f1e2022c01b472786a93a4cc85de909d9f1f98d1917d6","app/styles/protocol-office.css":"ced13afcecbb01286e89e48b5af692520a691df7ad3fdb06d46cf9f4c4d07ec8","app/styles/protocol-roles.css":"d136a1ec9477cd4b9e6994ac71ab53af5c1313b844469844cbf82dd8ded2d2f6","app/styles/protocol.css":"16e5956286bd65c9f707fce6020b6bcbd44a50b543f1a9bc95cfb0fa7c3530ad","app/styles/push.css":"7cba76de6abc6e88ffe34bb738318a517fd4352dcc6490d1616d06e904e874cf","app/styles/quote.css":"4d5b1baea5a7fa00286ecdc8b21ec0d8aae8d973dc384fdaa687a4f15694da47","app/styles/quotes.css":"0895d93ea7a158419a14a12fad34a3d1974c18847e19cc5f0e51c91a141041aa","app/styles/scripts-view.css":"da3b7ebd40571c44fdd4d2ba93d708f4c960d1dc98ccb3d03550f85f2ee10e81","app/styles/scripts.css":"5d93baf1c471b91385c41511d5eca932a0c7150dd4b93b8250f482bf791d3665","app/styles/shell.css":"760e4a9dafb5b42892a7b21eb2a531b68b96e22833b580b98959322f54c4a666","app/styles/staff-tasks.css":"40d07949db837065f31ff06a25d868683195dad0d8acf41fe1b36c6b56d4e70c","app/styles/status-card.css":"3d2f386b2f7e885afd8e1dccf64c7faa944eb4abe7699226ca2c24cff6fbe782","app/styles/status.css":"84e895d17730bc44f19111add793153baf7b47b6adc8a872cac334317da5a79a","app/styles/team.css":"218806f56a9e027bd5819b6c750c9eba23a44f7f287817d2f836a01b9290f536","app/styles/tokens.css":"aed87f86b6d9b3d5df647429db28eba13a87c968baa11e7ec3781c0ef2879e4d","app/styles/whatsapp.css":"043d77cee016735843592a04cec50b16d8bac6fd8fc61f99f7539fd216032a5b","app/styles/year.css":"fbe8ef429c761643a9d10380d9fb99f9b7611438d6f7ebc28d2531fc47768324","app/supa.js":"29fa97326d9965fc3d7320a87f6239134f72f840274307b45194b261582e7d5e","app/surveys.js":"a4d4f9cd4e2479084c2f8f7ca24722eed3cf3f5372a0fcc9b8b7b5cd5ddd143a","app/team-rules.js":"87fbfad386801f29960a2a68d3be2fd165c29ff38f353657dbb77a281d010a05","app/team.js":"417c2cd9421e93e36d7b5f0751c44e5abe698704452fbd06529e8b073ac2b68c","app/turns.js":"ae392c891673fab2cdb38b39bced06725c99158d8e0bcd74e88b4935086f4748","app/tz.js":"ee0f143edf0a63b7ea240f3e83e53bbda2db1501a4e992dee63788fd0ec7fd32","app/unsigned-logic.js":"3f26e386c394fb81d9eae0763e65f1b57056424a7d239f57037d47d4d95514fa","app/upload.js":"5e851d69cc1f253be0c2533ded69efa517add9ef0323bbae9b47b677a4ea6c77","app/vault-code-team.js":"8e86d0950a13a4de6b893a6d47a8ba083a69c3c8a0500978bcd43a2f5c51a683","app/vault-code.js":"185a9610edde21c5402949f1ca3a9adc3b93495f7673dec38e7ad3cbfe9ca30a","app/vault-gate.js":"d7bd533353ac0d03875d4ba7967a5282935ad6e2df6b27372fd207a46a628f03","app/vendor/supabase.js":"649e46c496fae692ad4fc75ee1a9da5315f79029267cd4df847e7de192cacf77","app/visit.js":"224dc4a0e69dae6d1a4b03038509b09a68ca426961f7d7902fb31c394e75ed34","app/wa-logic.js":"5dfb62037fa4db329ba575355a035a15e671cea13bd3155748a27d353ef3b406","app/wa-team.js":"1d42baa7e2258f3f00c87a644afb73e11d3f9364b1197c93d8e1b771e76a6d02","app/wa-templates.js":"77d5cd7b2c2c7009cf6bda1f53efe4da2b18b83832f6ced40ee2b930ca155077","app/week-chart.js":"2399112320f3aa5c48a2a45ceb2d9de8c1e0ffa3163f7d75103b44d3b528cd36","app/whatsapp.js":"c6cae6fc1ed6a6372689daa49cb90fbda6fa94527ccb0769950569cfdab62f78","app/year-data.js":"a8c652ced94694b9794c3c71e27de06853e2422eb5d4dbef80249c0171125c74","app/year-logic.js":"4c2d7c7e32897837391d6a499eea264fbb8762e5aa0eb5e9697137d7c35313f4","app/year-rules.js":"7b2a7201d32ba774ec5b5f6b15ec730e257bcf3f33ea0b13d29c26951439e87c","app/year.js":"100979bdbb09429ec6f58d3f242938f28c1e1d73c8a1f129c0a6ce568591400e","calendar.html":"cc1ffff8119571b2e327a339350571f562b4ec100babfcb01da731381cdb894f","client.html":"46d478d66809904c3019a07d4f8acb583eccc98565958c631d8136941a581b19","clients.html":"65d9f7689ad89c53b5f542675d88eabd00176c7755f851043beadda4ee938412","clients.webmanifest":"26db9e715f603aa852bbfc7d347786b46a93148b00f53152612eece21025655a","deal.html":"bffe2f2680ece823b8cb6ff68976de946d701a7825f3d2035941a51da0ab98d0","decisions.html":"4684edc4d3d01218a884883cce7e461427ecb992a9073d8c4dd12937bf9701a8","editor.html":"65b0c8f38f23939ce9a03c49986d98391a4a9788dd71e22d7ee630476c2a85d0","gallery.html":"bb1f481f6c49358e357c33ad2b275e647624d8aaa58477071a051816c7b6e4ba","gantt.html":"870a2874a4e2d79138ca2fe224a40988ee89241329a6f5fd858e9219361b6391","index.html":"8aee311e3475904163f91a9c06fb16d9792756753e9288e3d0b8553c0ee9b38b","insights.html":"7f789945a33fd56430d3a32217a47d8d766296def0648a47f84b45ac95d7ad3c","intake-link.html":"71491d0a01c61494ed90770fe0c52b5121f89268e6debc7f93c681262385ce32","intake.html":"4ed94b2f980e06e0017802040f34d10fc0106f094d48bfd37b7613c48c8499d6","landing.html":"0b7f799d11ef62e501fa3f93af90678650aa9c66c83c1639e527e02b25625690","legacy-contract.html":"d53cbee252fd7af58453545363cceef49b2f3c5d77bd32e0709fbe574cd56114","messages.html":"fe7ef1b39733ea43e7912c462b93744ab4e9b902d4278d36a0425ff292aff960","owner.html":"17ea34e3b068342e61e98d295bb9b4dbfd89f16c664dc9f7b9932453f1384f3e","pass.html":"701ea3f6b01f60f52ea0032a05f3df7d14951ddc0d50ae5db78d02ae3bca8c6a","payouts/icons/apple-touch-icon.png":"92be9723bfd93667664b9b95faad98814797f4234abfc18019ee86913a379b4a","payouts/icons/icon-192.png":"5a91a352273691a55273d1a4c18461de1d259b63c409e711348fefe59d1378b8","payouts/icons/icon-512.png":"56a1b7ae11292a27300ff62fcf5882d4b617f756176bf1d42423275386c3dd8d","payouts/icons/icon-maskable-512.png":"63e86d4264628005c7cbd01c7af0f5e61dcc76a1a3822f37a5785d3a9a2ceb8f","payouts/index.html":"ea2dc01ad9468ce7639c25f6199b89f55623d1bee253e4e8f2ef196c375788ad","payouts/manifest.webmanifest":"826378c942f268ca87f6208bca8cbc8d73c8d578c62af9db3a4bab6522dc4855","prep.html":"e9e8256e43dca6a0e1aab4a3f970abac693138b7d32e8dcdf7c755a32c2319b5","q.html":"a7e8af3c72565e4246c6f5901edef79de861bfe0d621baf291527be0ad0718c6","qa.html":"bd419e8e0d0f6f476cec7700ed14a13d5716111aa4adb40618542c0291a2d8fb","quotes.html":"f4dafd1f24ae680d0850bcbd35440dd6934a7167034571855fe2f266a6f48940","scripts-view.html":"5edf77c5df6ac42a04335cb6f2a5a857287bf25e11dad713adf90faa78854485","scripts.html":"1a6341313c2a617ab34ce91325dc1d19956ee3fc903e66f153ce27350b784db2","shoot.html":"a8524da9ccc70d5f9c93191201a10cf21468936735e1bfb2e98547fe83d49166","staff-privacy.html":"7c34fce36252de1e0cc0ee82e34b7b0cc03193199f4621124f5298e985682faa","status.html":"6756f8f5364962d80f891afe8ca24a5e7a1ea120a9226cc6e9c8a7854c0d8091","team.html":"1a456cfc14c031ab450c8b7bf6d7d419302c36a19257086925c04f28e8211507","year.html":"e241b47991a95d97896b554ab98f380aca9d127e1350540f24da7fdbb24d9b61"}};
// One store per published version. A version is used only once it is whole (every
// file fetched and its content checked against the list), so a page never runs
// scripts of two versions; until then the last whole version answers, or the network.
const STORE = 'astrateg-site-';
const WHOLE = '__whole__';
const own = BUILD ? `${STORE}${BUILD.version}` : null;
const at = (path) => new URL(path, self.registration.scope).href;
// The file a same-site address stands for ('' and 'payouts/' are their index.html).
function fileOf(url) {
  const base = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(base)) return null;
  let path = url.pathname.slice(base.length);
  try { path = decodeURIComponent(path); } catch { return null; }
  if (path === '' || path.endsWith('/')) path += 'index.html';
  return path;
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function listOf(name) {
  try {
    const hit = await (await caches.open(name)).match(at(WHOLE));
    return hit ? await hit.json() : null;
  } catch { return null; }
}
// The version that answers now: this one when it is whole, else the newest whole one before it.
let answering = null;
let before; // looked up once: the older stores do not change until this one is whole
async function wholeStore() {
  if (answering) return answering;
  if (await listOf(own)) { answering = own; return own; }
  before ??= (async () => {
    const names = (await caches.keys()).filter((n) => n.startsWith(STORE) && n !== own).reverse();
    for (const n of names) if (await listOf(n)) return n;
    return null;
  })();
  return before;
}
// A page keeps the version it opened with. Kept in memory: a new worker starts by giving
// every page that is already open the version that answered until now (fill), and after
// a plain restart of the same worker a page takes the version that answers now.
const pinned = new Map();

// Fetches what this version is missing: a file an older version already holds with the
// same content is copied, the rest come from the network past every cache
// and are checked. Any failure leaves the store unfinished; the next page tries again.
let filling = null;
function fillStore() {
  filling ||= fill().catch(() => false).finally(() => { filling = null; });
  return filling;
}
async function fill() {
  if (await listOf(own)) return true;
  // The pages that are open now were opened before this version was whole.
  const until = await wholeStore();
  if (until && until !== own) {
    for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) if (!pinned.has(c.id)) pinned.set(c.id, until);
  }
  const cache = await caches.open(own);
  const olds = [];
  for (const n of (await caches.keys()).filter((x) => x.startsWith(STORE) && x !== own)) {
    const files = await listOf(n);
    if (files) olds.push([await caches.open(n), files]);
  }
  const take = async (path) => {
    const want = BUILD.files[path];
    if (await cache.match(at(path))) return;
    for (const [old, files] of olds) {
      if (files[path] !== want) continue;
      const kept = await old.match(at(path));
      if (kept) { await cache.put(at(path), kept); return; }
    }
    const res = await fetch(`${at(path)}?v=${want.slice(0, 16)}`, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const body = await res.arrayBuffer();
    if (hex(await crypto.subtle.digest('SHA-256', body)) !== want) throw new Error(`${path}: not the published content`);
    await cache.put(at(path), new Response(body, { status: 200, headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } }));
  };
  const paths = Object.keys(BUILD.files);
  let next = 0;
  const lane = async () => { while (next < paths.length) await take(paths[next++]); };
  await Promise.all(Array.from({ length: 6 }, lane));
  await cache.put(at(WHOLE), new Response(JSON.stringify(BUILD.files), { headers: { 'content-type': 'application/json' } }));
  answering = own;
  // Older versions go, except one a page that is still open runs on. That page is told,
  // so it can load itself again when that disturbs nobody (app/feel.js).
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const ids = new Set(open.map((c) => c.id));
  for (const id of [...pinned.keys()]) if (!ids.has(id)) pinned.delete(id);
  const keep = new Set([own, ...pinned.values()]);
  for (const n of await caches.keys()) if (n.startsWith(STORE) && !keep.has(n)) await caches.delete(n);
  for (const c of open) if (pinned.has(c.id) && pinned.get(c.id) !== own) c.postMessage({ type: 'astrateg-update', version: BUILD.version });
  return true;
}

async function answer(event, path) {
  const nav = event.request.mode === 'navigate';
  let name = nav ? null : pinned.get(event.clientId);
  if (!name) {
    name = await wholeStore();
    const id = nav ? event.resultingClientId : event.clientId;
    if (name && id) pinned.set(id, name);
  }
  if (name) {
    const hit = await (await caches.open(name)).match(at(path));
    if (hit) return hit;
  }
  return fetch(event.request);
}

// A worker that keeps nothing (the repository, or a publish made with --no-store) clears what an earlier one kept.
if (!BUILD) {
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => { for (const n of await caches.keys()) if (n.startsWith(STORE)) await caches.delete(n); })().catch(() => {}));
  });
}
if (BUILD) {
  // A newer publish: its files are fetched at once (the pages are answered from the older
  // store meanwhile). The very first store waits for the page to ask, once it is shown,
  // so it does not take the network from a page that is still loading.
  self.addEventListener('activate', () => { wholeStore().then((name) => { if (name) fillStore(); }).catch(() => {}); });
  // A page that opened asks for the store to be completed (app/feel.js).
  self.addEventListener('message', (event) => { if (event.data?.type === 'astrateg-fill') event.waitUntil(fillStore()); });
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || req.headers.has('range')) return;
    const url = new URL(req.url);
    // Another host (the database, the functions, the client's files): never touched, never stored.
    if (url.origin !== self.location.origin) return;
    const path = fileOf(url);
    if (!path || !Object.prototype.hasOwnProperty.call(BUILD.files, path)) return;
    if (req.mode === 'navigate' && answering !== own) event.waitUntil(fillStore());
    event.respondWith(answer(event, path));
  });
}

// A link inside the site, or the "my work" page.
function inSite(href) {
  try {
    const u = new URL(href || HOME, self.registration.scope);
    if (u.origin === self.location.origin) return u.href;
  } catch { /* not a URL */ }
  return new URL(HOME, self.registration.scope).href;
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = String(data.title || 'אסטרטג').slice(0, 200);
  event.waitUntil(self.registration.showNotification(title, {
    body: String(data.body || '').slice(0, 1000),
    tag: data.tag ? String(data.tag).slice(0, 200) : undefined,
    renotify: !!(data.tag && data.renotify),
    data: { href: inSite(data.url) },
    dir: 'rtl',
    lang: 'he',
    icon: new URL('payouts/icons/icon-192.png', self.registration.scope).href,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let href = null;
  try { href = new URL(event.notification.data?.href); } catch { return; }
  if (href.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url === href.href);
    if (open) return open.focus();
    return self.clients.openWindow(href.href);
  })());
});
