// Constants shared by both data backends (keep in sync with supabase/schema.sql).

/** ~100 m grid used for the privacy-safe demand map (same math as open_demand() in schema.sql). */
export const CELL = 0.001;
export const cellOf = (lat, lng) => ({
  lat: Math.round((Math.floor(lat / CELL) * CELL + CELL / 2) * 1e6) / 1e6,
  lng: Math.round((Math.floor(lng / CELL) * CELL + CELL / 2) * 1e6) / 1e6,
});

export const REQUEST_DAYS = 3;
export const EGYPT = { latMin: 22, latMax: 32, lngMin: 24, lngMax: 37 };
export const inEgypt = (lat, lng) => lat >= EGYPT.latMin && lat <= EGYPT.latMax && lng >= EGYPT.lngMin && lng <= EGYPT.lngMax;

/** Service sectors, in the order residents see them. [key, icon, name_en, name_ar] */
export const SECTORS = [
  ['home', '🏠', 'Home essentials', 'احتياجات المنزل'],
  ['food', '🧺', 'Food & groceries', 'الغذاء والبقالة'],
  ['medical', '🩺', 'Health & medical', 'الصحة والعلاج'],
  ['trades', '🛠️', 'Repairs & trades', 'الحِرف والصيانة'],
  ['transport', '🚚', 'Transport & delivery', 'النقل والتوصيل'],
  ['farming', '🌾', 'Farming & livestock', 'الزراعة والثروة الحيوانية'],
  ['shops', '🛍️', 'Shops & goods', 'المتاجر والسلع'],
  ['vehicles', '🚗', 'Cars & motorbikes', 'السيارات والدراجات'],
  ['tech', '💻', 'Phones, computers & internet', 'الهواتف والحاسوب والإنترنت'],
  ['building', '🧱', 'Building & construction', 'البناء والتشييد'],
  ['industry', '🏭', 'Industry & workshops', 'الصناعة والورش'],
  ['education', '📖', 'Education & childcare', 'التعليم ورعاية الأطفال'],
  ['personal', '💈', 'Personal care & tailoring', 'العناية الشخصية والخياطة'],
  ['events', '🎉', 'Events & occasions', 'المناسبات والحفلات'],
  ['professional', '💼', 'Professional services', 'الخدمات المهنية'],
  ['other', '✨', 'Other', 'أخرى'],
];
export const PLACE_SECTOR = ['places', '📍', 'Village places', 'أماكن القرية'];

/**
 * Every service a village can ask for. [key, sector, icon, name_en, name_ar, search words]
 * The search words are only used to find a category (they include everyday spellings people type);
 * they are never shown.
 */
export const SERVICES = [
  ['gas', 'home', '🔥', 'Gas cylinders', 'أسطوانات الغاز', 'انبوبه انبوبة أنبوبة بوتاجاز غاز بوتجاز cylinder butane'],
  ['water', 'home', '💧', 'Drinking water', 'مياه الشرب', 'مياه مية ميه جركن جراكن فلتر water'],
  ['cleaning', 'home', '🧽', 'Home cleaning', 'تنظيف المنازل', 'نظافه تنظيف عامله cleaner'],
  ['laundry', 'home', '👕', 'Laundry & ironing', 'الغسيل والكي', 'مكوجي مكوه كي غسيل ironing'],
  ['tank_cleaning', 'home', '🛢️', 'Water tank cleaning', 'تنظيف خزانات المياه', 'خزان تنك فنطاس tank'],
  ['pest_control', 'home', '🪳', 'Pest control', 'مكافحة الحشرات', 'رش صراصير ناموس فيران فئران حشرات بق'],
  ['furniture', 'home', '🛋️', 'Furniture & upholstery', 'الأثاث والتنجيد', 'منجد تنجيد مراتب كنب انتريه موبيليا'],
  ['grocery', 'food', '🛒', 'Groceries', 'البقالة', 'بقال سوبر ماركت تموين رز سكر زيت'],
  ['bakery', 'food', '🍞', 'Bread & bakery', 'الخبز والمخبوزات', 'عيش فرن خبز بلدي فينو'],
  ['vegetables', 'food', '🥕', 'Vegetables & fruit', 'الخضروات والفاكهة', 'خضار خضرة فاكهه طماطم بطاطس'],
  ['meat', 'food', '🥩', 'Meat', 'اللحوم', 'جزار لحمه لحمة كفته'],
  ['poultry', 'food', '🍗', 'Poultry & eggs', 'الدواجن والبيض', 'فراخ بط وز حمام بيض طيور'],
  ['fish', 'food', '🐟', 'Fish', 'الأسماك', 'سمك بلطي فسيخ'],
  ['dairy', 'food', '🧀', 'Milk & dairy', 'الألبان ومنتجاتها', 'لبن جبنه جبنة زبده سمن قشطه'],
  ['sweets', 'food', '🍰', 'Sweets & cakes', 'الحلويات', 'حلواني كيك تورته بسبوسه'],
  ['ready_food', 'food', '🍲', 'Restaurants & ready meals', 'المطاعم والوجبات الجاهزة', 'مطعم فول طعميه كشري اكل سندوتشات'],
  ['home_food', 'food', '🥘', 'Home-cooked food', 'الطعام المنزلي', 'اكل بيتي محشي فطير'],
  ['pharmacy', 'medical', '💊', 'Pharmacy delivery', 'توصيل الأدوية', 'صيدليه دوا دواء علاج روشته'],
  ['doctor', 'medical', '🩺', 'Doctor home visit', 'زيارة طبيب منزلية', 'دكتور طبيب كشف'],
  ['nursing', 'medical', '💉', 'Nursing & injections', 'التمريض والحقن', 'ممرضه ممرض حقنه محلول جروح غيار'],
  ['lab', 'medical', '🧪', 'Home lab tests', 'التحاليل المنزلية', 'تحليل معمل سكر دم'],
  ['physio', 'medical', '🦴', 'Physiotherapy', 'العلاج الطبيعي', 'علاج طبيعي مساج'],
  ['dentist', 'medical', '🦷', 'Dentist', 'طب الأسنان', 'سنان اسنان ضرس'],
  ['eye_care', 'medical', '👓', 'Eye care & glasses', 'العيون والنظارات', 'نظاره نضاره عيون'],
  ['ambulance', 'medical', '🚑', 'Patient transport', 'نقل المرضى', 'اسعاف عربيه مريض'],
  ['elder_care', 'medical', '🧓', 'Elderly care', 'رعاية المسنين', 'مسن كبار السن مرافق'],
  ['medical_supplies', 'medical', '🩼', 'Medical equipment', 'المستلزمات الطبية', 'كرسي متحرك جهاز ضغط اكسجين سرير طبي'],
  ['plumbing', 'trades', '🔧', 'Plumbing', 'السباكة', 'سباك مواسير حنفيه حمام تسريب'],
  ['electric', 'trades', '💡', 'Electrician', 'الكهرباء', 'كهربائي كهربجي فيشه لمبه نور'],
  ['carpentry', 'trades', '🪚', 'Carpentry', 'النجارة', 'نجار باب شباك دولاب خشب'],
  ['painting', 'trades', '🖌️', 'Painting', 'الدهان', 'نقاش دهان بويه محاره'],
  ['appliance', 'trades', '🔌', 'Appliance repair', 'صيانة الأجهزة المنزلية', 'غساله تلاجه ثلاجه بوتجاز سخان مروحه'],
  ['ac_repair', 'trades', '❄️', 'AC & refrigeration', 'التكييف والتبريد', 'تكييف فريون تبريد'],
  ['welding', 'trades', '⚒️', 'Blacksmith & welding', 'الحدادة واللحام', 'حداد لحام بوابه شبابيك حديد'],
  ['aluminium', 'trades', '🪟', 'Aluminium & glass', 'الألوميتال والزجاج', 'الوميتال قزاز زجاج'],
  ['locksmith', 'trades', '🔑', 'Locks & keys', 'الأقفال والمفاتيح', 'كالون مفتاح قفل'],
  ['delivery', 'transport', '🛵', 'Delivery & errands', 'توصيل الطلبات', 'دليفري مشوار توصيل'],
  ['transport', 'transport', '🛺', 'Tuk-tuk rides', 'التوك توك', 'توكتوك توك مواصلات'],
  ['taxi', 'transport', '🚕', 'Car hire & taxi', 'سيارات الأجرة', 'تاكسي عربيه ملاكي اجره سفر'],
  ['microbus', 'transport', '🚐', 'Microbus & group trips', 'النقل الجماعي', 'ميكروباص رحله مشروع'],
  ['truck', 'transport', '🚚', 'Goods transport', 'نقل البضائع', 'نقل نص نقل عربيه ربع نقل جرار'],
  ['moving', 'transport', '📦', 'House moving', 'نقل الأثاث', 'عزال عفش'],
  ['shipping', 'transport', '📮', 'Parcels & shipping', 'شحن الطرود', 'شحن طرد بوسطه'],
  ['tractor', 'farming', '🚜', 'Tractor & ploughing', 'الجرارات والحرث', 'جرار حرت حرث تسويه ارض'],
  ['irrigation', 'farming', '💦', 'Irrigation & pumps', 'الري والمضخات', 'ماكينه ري طلمبه مضخه'],
  ['seeds', 'farming', '🌱', 'Seeds & fertiliser', 'البذور والأسمدة', 'تقاوي سماد كيماوي اسمده'],
  ['spraying', 'farming', '🧴', 'Pesticide spraying', 'رش المبيدات', 'رش مبيد دودة'],
  ['harvest', 'farming', '🌾', 'Harvest & threshing', 'الحصاد والدراس', 'حصاده دراسه قمح رز'],
  ['farm_labour', 'farming', '👨‍🌾', 'Farm workers', 'العمالة الزراعية', 'انفار عمال فلاحين'],
  ['animal_feed', 'farming', '🌽', 'Animal feed', 'الأعلاف', 'علف ردة رده تبن دريس'],
  ['vet', 'farming', '🐄', 'Veterinarian', 'الطب البيطري', 'دكتور بيطري بهايم مواشي جاموسه'],
  ['livestock', 'farming', '🐑', 'Livestock trade', 'تجارة المواشي', 'جاموسه بقره خروف ماعز عجل'],
  ['clothing', 'shops', '👗', 'Clothes & shoes', 'الملابس والأحذية', 'هدوم لبس جزمه شوز'],
  ['household', 'shops', '🍳', 'Household goods', 'الأدوات المنزلية', 'ادوات مطبخ حلل بلاستيك'],
  ['books', 'shops', '📚', 'Books & stationery', 'المكتبات والأدوات المدرسية', 'مكتبه كشاكيل اقلام'],
  ['electronics', 'shops', '📺', 'Electrical appliances', 'الأجهزة الكهربائية', 'تلفزيون شاشه غساله تلاجه'],
  ['hardware', 'shops', '🔩', 'Hardware & paint', 'الخردوات والدهانات', 'عدد مسامير بويه'],
  ['cosmetics', 'shops', '💄', 'Cosmetics & perfume', 'مستحضرات التجميل والعطور', 'برفان ميكب ميك اب'],
  ['gifts', 'shops', '🧸', 'Toys & gifts', 'الألعاب والهدايا', 'لعب هدايا'],
  ['mechanic', 'vehicles', '🚗', 'Car mechanic', 'ميكانيكا السيارات', 'ميكانيكي عربيه موتور'],
  ['tyres', 'vehicles', '🛞', 'Tyres', 'الإطارات', 'كاوتش بنشر عجل كوتش'],
  ['auto_electric', 'vehicles', '🔋', 'Car electrics & batteries', 'كهرباء السيارات والبطاريات', 'بطاريه كهربا عربيات'],
  ['motorbike', 'vehicles', '🏍️', 'Motorbike & tuk-tuk repair', 'صيانة الدراجات النارية', 'موتوسيكل توكتوك'],
  ['bicycle', 'vehicles', '🚲', 'Bicycle repair', 'صيانة الدراجات', 'عجله بسكلته'],
  ['car_wash', 'vehicles', '🧼', 'Car wash', 'غسيل السيارات', 'غسيل عربيه'],
  ['fuel', 'vehicles', '⛽', 'Fuel delivery', 'توصيل الوقود', 'بنزين سولار جاز'],
  ['phones', 'tech', '📱', 'Phones & accessories', 'الهواتف وملحقاتها', 'موبايل تليفون شاحن سماعه'],
  ['phone_repair', 'tech', '📲', 'Phone repair', 'صيانة الهواتف', 'تصليح موبايل شاشه'],
  ['computer', 'tech', '💻', 'Computer repair', 'صيانة الحاسوب', 'كمبيوتر لابتوب'],
  ['internet', 'tech', '🌐', 'Internet & networks', 'الإنترنت والشبكات', 'نت راوتر واي فاي واى فاى'],
  ['satellite', 'tech', '📡', 'Satellite dishes', 'أطباق الاستقبال', 'دش ريسيفر'],
  ['cctv', 'tech', '📹', 'Security cameras', 'كاميرات المراقبة', 'كاميرا مراقبه'],
  ['printing', 'tech', '🖨️', 'Printing & copying', 'الطباعة والتصوير', 'تصوير ورق طباعه'],
  ['e_services', 'tech', '🧾', 'Online services & bills', 'الخدمات الإلكترونية والفواتير', 'شحن رصيد فاتوره كهربا تموين حكومه'],
  ['software', 'tech', '👨‍💻', 'Websites & software', 'المواقع والبرمجة', 'موقع برنامج تطبيق'],
  ['mason', 'building', '🧱', 'Masonry & building', 'أعمال البناء', 'بنا مبيض طوب'],
  ['tiling', 'building', '🔲', 'Tiling & marble', 'البلاط والرخام', 'سيراميك بلاط رخام مبلط'],
  ['plastering', 'building', '🏗️', 'Plastering', 'المحارة', 'محاره لياسه'],
  ['building_materials', 'building', '🧰', 'Building materials', 'مواد البناء', 'اسمنت رمل زلط حديد طوب'],
  ['contractor', 'building', '👷', 'Contractor', 'المقاولات', 'مقاول'],
  ['surveyor', 'building', '📐', 'Engineer & surveyor', 'الهندسة والمساحة', 'مهندس رخصه مساحه'],
  ['machining', 'industry', '⚙️', 'Lathe & machining', 'الخراطة وتشغيل المعادن', 'مخرطه خراط'],
  ['motor_rewind', 'industry', '🌀', 'Motor rewinding', 'لف المحركات', 'لف مواتير موتور'],
  ['generators', 'industry', '⚡', 'Generators', 'المولدات الكهربائية', 'مولد ماتور كهربا'],
  ['well_drilling', 'industry', '🕳️', 'Well drilling', 'حفر الآبار', 'بير بئر طلمبه'],
  ['equipment_rental', 'industry', '🏗️', 'Equipment rental', 'تأجير المعدات', 'لودر حفار ونش'],
  ['manufacturing', 'industry', '🏭', 'Custom manufacturing', 'التصنيع حسب الطلب', 'ورشه تصنيع مصنع'],
  ['scrap', 'industry', '♻️', 'Scrap & recycling', 'الخردة وإعادة التدوير', 'روبابيكيا خرده'],
  ['tutoring', 'education', '✏️', 'Private lessons', 'الدروس الخصوصية', 'درس مدرس مدرسه'],
  ['quran', 'education', '📖', 'Quran teaching', 'تحفيظ القرآن', 'كتاب قران تحفيظ'],
  ['childcare', 'education', '👶', 'Nursery & childcare', 'الحضانة ورعاية الأطفال', 'حضانه اطفال'],
  ['courses', 'education', '🎓', 'Training courses', 'الدورات التدريبية', 'كورس دوره'],
  ['languages', 'education', '🗣️', 'Language lessons', 'تعليم اللغات', 'انجليزي لغات'],
  ['barber', 'personal', '💈', 'Barber', 'الحلاقة', 'حلاق'],
  ['salon', 'personal', '💇‍♀️', "Women's salon", 'التجميل للسيدات', 'كوافير'],
  ['tailor', 'personal', '🧵', 'Tailor', 'الخياطة', 'ترزي خياط خياطه'],
  ['shoe_repair', 'personal', '👞', 'Shoe repair', 'إصلاح الأحذية', 'جزمجي'],
  ['catering', 'events', '🍽️', 'Catering & banquets', 'الطهي والولائم', 'طباخ عزومه'],
  ['tents', 'events', '⛺', 'Tents & chairs', 'السرادقات والكراسي', 'فراشه صوان كراسي'],
  ['sound', 'events', '🔊', 'Sound & lighting', 'الصوت والإضاءة', 'دي جي سماعات'],
  ['photography', 'events', '📷', 'Photography', 'التصوير الفوتوغرافي', 'مصور فيديو'],
  ['wedding', 'events', '💍', 'Weddings', 'تجهيز الأفراح', 'فرح عروسه'],
  ['lawyer', 'professional', '⚖️', 'Lawyer', 'المحاماة', 'محامي قضيه'],
  ['accountant', 'professional', '🧮', 'Accountant & taxes', 'المحاسبة والضرائب', 'محاسب ضرائب'],
  ['real_estate', 'professional', '🏘️', 'Real estate', 'الوساطة العقارية', 'سمسار شقه ارض'],
  ['paperwork', 'professional', '📝', 'Paperwork & forms', 'استخراج الأوراق الرسمية', 'ورق حكومي مستخرج شهاده'],
  ['translation', 'professional', '🔤', 'Translation', 'الترجمة', 'ترجمه'],
  ['insurance', 'professional', '🛡️', 'Insurance', 'التأمين', 'تامين'],
  ['other', 'other', '✨', 'Something else', 'أخرى', 'اي حاجه غير ذلك'],
];

/** Landmarks for the village guide. [key, icon, name_en, name_ar] */
export const PLACES = [
  ['mosque', '🕌', 'Mosque', 'مسجد'],
  ['church', '⛪', 'Church', 'كنيسة'],
  ['health', '🏥', 'Hospital / health unit', 'مستشفى / وحدة صحية'],
  ['clinic', '🩺', 'Clinic', 'عيادة'],
  ['pharmacy_place', '⚕️', 'Pharmacy', 'صيدلية'],
  ['school', '🏫', 'School', 'مدرسة'],
  ['kindergarten', '🧒', 'Kindergarten', 'روضة أطفال'],
  ['government', '🏛️', 'Government office', 'جهة حكومية'],
  ['post', '📮', 'Post office', 'مكتب بريد'],
  ['bank', '🏧', 'ATM / bank', 'ماكينة صرف / بنك'],
  ['police', '🚓', 'Police', 'نقطة شرطة'],
  ['fire', '🚒', 'Fire station', 'مطافئ'],
  ['youth', '⚽', 'Youth center', 'مركز شباب'],
  ['market', '🧺', 'Market', 'سوق'],
  ['bakery_place', '🥖', 'Bakery', 'مخبز'],
  ['fuel_station', '⛽', 'Fuel station', 'محطة وقود'],
  ['transport_stop', '🚏', 'Transport stop', 'موقف المواصلات'],
  ['vet_place', '🐄', 'Veterinary unit', 'وحدة بيطرية'],
  ['agri_coop', '🌾', 'Agricultural cooperative', 'الجمعية الزراعية'],
  ['park', '🌳', 'Garden', 'حديقة'],
  ['cemetery', '🪦', 'Cemetery', 'مقابر'],
];

/** Seeded when a village is created. [key, kind, sector, icon, name_en, name_ar] (sort = position × 10) */
export const DEFAULT_CATEGORIES = [
  ...SERVICES.map(([key, sector, icon, en, ar]) => [key, 'service', sector, icon, en, ar]),
  ...PLACES.map(([key, icon, en, ar]) => [key, 'place', 'places', icon, en, ar]),
];
export const SEARCH_WORDS = Object.fromEntries(SERVICES.map(s => [s[0], s[5]]));
/** Shown first on Home and in the "I need…" picker when the village has no providers yet. */
export const POPULAR = ['gas', 'bakery', 'grocery', 'pharmacy', 'delivery', 'transport', 'plumbing', 'electric'];

/** Village size choices when the mayor sets up the map (metres around the centre). */
export const AREA_SIZES = [['small', 600], ['medium', 1000], ['large', 1600]];
export const RADIUS = { min: 300, max: 3000, default: 1000 };
