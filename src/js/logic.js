// 文件路径: src/js/logic.js
/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [v3.5 增强] 集成频道名称归一化逻辑，支持自定义映射表
 */

import { smartFind, isGzipContent } from './utils.js';

// --- 默认配置常量 ---
const DEFAULT_CACHE_TTL = 3600;
const DEFAULT_FETCH_TIMEOUT = 20000;
const DEFAULT_MAX_MEMORY_CACHE = 40 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_SIZE = 150 * 1024 * 1024;
const DEFAULT_ERROR_COOLDOWN = 2 * 60 * 1000;

// =========================================================
// [新增] 频道名别名映射表 (请在此处维护你的 JSON 内容)
// =========================================================
const CHANNEL_ALIASES = {
  'CCTV1': [
    'CCTV-1', 'CCTV－1', 'CCTV_1', 'CCTV 1',
    'CCTV1综合', 'CCTV-1综合', 'CCTV1综合频道',
    'CCTV1HD', 'CCTV-1HD', 'CCTV1高清', 'CCTV-1高清',
    'CCTV1超清', 'CCTV14K', 'CCTV-14K',
    '中央1台', '中央一台', '中央电视台1', '中央电视台综合',
    'CCTV1(综合)', 'CCTV-1(综合)', 'CCTV1 综合',
    'CCTV1FHD', 'CCTV1UHD', 'CCTV综合'
  ],
  
  'CCTV2': [
    'CCTV-2', 'CCTV－2', 'CCTV_2', 'CCTV 2',
    'CCTV2财经', 'CCTV-2财经', 'CCTV2经济',
    'CCTV2HD', 'CCTV-2HD', 'CCTV2高清',
    '中央2台', '中央二台', '中央电视台2',
    'CCTV2(财经)', 'CCTV-2(财经)', 'CCTV财经'
  ],
  
  'CCTV3': [
    'CCTV-3', 'CCTV－3', 'CCTV_3', 'CCTV 3',
    'CCTV3综艺', 'CCTV-3综艺', 'CCTV3综艺频道',
    'CCTV3HD', 'CCTV-3HD', 'CCTV3高清',
    '中央3台', '中央三台', '中央电视台3',
    'CCTV3(综艺)', 'CCTV-3(综艺)', 'CCTV综艺'
  ],
  
  'CCTV4': [
    'CCTV-4', 'CCTV－4', 'CCTV_4', 'CCTV 4',
    'CCTV4中文国际', 'CCTV-4中文国际', 'CCTV4国际',
    'CCTV4HD', 'CCTV-4HD', 'CCTV4高清',
    '中央4台', '中央四台', '中央电视台4',
    'CCTV4(中文国际)', 'CCTV-4(中文国际)',
    'CCTV4亚洲', 'CCTV4欧洲', 'CCTV4美洲'
  ],
  
  'CCTV5': [
    'CCTV-5', 'CCTV－5', 'CCTV_5', 'CCTV 5',
    'CCTV5体育', 'CCTV-5体育', 'CCTV5体育频道',
    'CCTV5HD', 'CCTV-5HD', 'CCTV5高清',
    '中央5台', '中央五台', '中央电视台5',
    'CCTV5(体育)', 'CCTV-5(体育)', 'CCTV体育',
    'CCTV5FHD', 'CCTV5UHD', 'CCTV54K'
  ],
  
  'CCTV5+': [
    'CCTV-5+', 'CCTV－5+', 'CCTV_5+', 'CCTV 5+',
    'CCTV5+体育', 'CCTV5+体育赛事', 'CCTV-5+体育赛事',
    'CCTV5+HD', 'CCTV-5+HD', 'CCTV5+高清',
    'CCTV5PLUS', 'CCTV-5PLUS', 'CCTV5PLUS体育',
    '中央5+台', 'CCTV5赛事', 'CCTV体育赛事',
    'CCTV5+(体育赛事)', 'CCTV-5+(体育赛事)',
    'CCTV5+ 体育赛事', 'CCTV 5+ 体育'
  ],
  
  'CCTV6': [
    'CCTV-6', 'CCTV－6', 'CCTV_6', 'CCTV 6',
    'CCTV6电影', 'CCTV-6电影', 'CCTV6电影频道',
    'CCTV6HD', 'CCTV-6HD', 'CCTV6高清',
    '中央6台', '中央六台', '中央电视台6',
    'CCTV6(电影)', 'CCTV-6(电影)', 'CCTV电影'
  ],
  
  'CCTV7': [
    'CCTV-7', 'CCTV－7', 'CCTV_7', 'CCTV 7',
    'CCTV7国防军事', 'CCTV-7国防军事', 'CCTV7军事',
    'CCTV7农业', 'CCTV7军事农业',
    'CCTV7HD', 'CCTV-7HD', 'CCTV7高清',
    '中央7台', '中央七台', '中央电视台7',
    'CCTV7(国防军事)', 'CCTV-7(国防军事)', 'CCTV国防军事'
  ],
  
  'CCTV8': [
    'CCTV-8', 'CCTV－8', 'CCTV_8', 'CCTV 8',
    'CCTV8电视剧', 'CCTV-8电视剧', 'CCTV8影视',
    'CCTV8HD', 'CCTV-8HD', 'CCTV8高清',
    '中央8台', '中央八台', '中央电视台8',
    'CCTV8(电视剧)', 'CCTV-8(电视剧)', 'CCTV电视剧'
  ],
  
  'CCTV9': [
    'CCTV-9', 'CCTV－9', 'CCTV_9', 'CCTV 9',
    'CCTV9纪录', 'CCTV-9纪录', 'CCTV9纪录片',
    'CCTV9HD', 'CCTV-9HD', 'CCTV9高清',
    '中央9台', '中央九台', '中央电视台9',
    'CCTV9(纪录)', 'CCTV-9(纪录)', 'CCTV纪录'
  ],
  
  'CCTV10': [
    'CCTV-10', 'CCTV－10', 'CCTV_10', 'CCTV 10',
    'CCTV10科教', 'CCTV-10科教', 'CCTV10科学',
    'CCTV10HD', 'CCTV-10HD', 'CCTV10高清',
    '中央10台', '中央十台', '中央电视台10',
    'CCTV10(科教)', 'CCTV-10(科教)', 'CCTV科教'
  ],
  
  'CCTV11': [
    'CCTV-11', 'CCTV－11', 'CCTV_11', 'CCTV 11',
    'CCTV11戏曲', 'CCTV-11戏曲', 'CCTV11戏曲频道',
    'CCTV11HD', 'CCTV-11HD', 'CCTV11高清',
    '中央11台', '中央十一台', '中央电视台11',
    'CCTV11(戏曲)', 'CCTV-11(戏曲)', 'CCTV戏曲'
  ],
  
  'CCTV12': [
    'CCTV-12', 'CCTV－12', 'CCTV_12', 'CCTV 12',
    'CCTV12社会与法', 'CCTV-12社会与法', 'CCTV12法制',
    'CCTV12HD', 'CCTV-12HD', 'CCTV12高清',
    '中央12台', '中央十二台', '中央电视台12',
    'CCTV12(社会与法)', 'CCTV-12(社会与法)', 'CCTV社会与法'
  ],
  
  'CCTV13': [
    'CCTV-13', 'CCTV－13', 'CCTV_13', 'CCTV 13',
    'CCTV13新闻', 'CCTV-13新闻', 'CCTV13新闻频道',
    'CCTV13HD', 'CCTV-13HD', 'CCTV13高清',
    '中央13台', '中央十三台', '中央电视台13',
    'CCTV13(新闻)', 'CCTV-13(新闻)', 'CCTV新闻'
  ],
  
  'CCTV14': [
    'CCTV-14', 'CCTV－14', 'CCTV_14', 'CCTV 14',
    'CCTV14少儿', 'CCTV-14少儿', 'CCTV14儿童',
    'CCTV14HD', 'CCTV-14HD', 'CCTV14高清',
    '中央14台', '中央十四台', '中央电视台14',
    'CCTV14(少儿)', 'CCTV-14(少儿)', 'CCTV少儿'
  ],
  
  'CCTV15': [
    'CCTV-15', 'CCTV－15', 'CCTV_15', 'CCTV 15',
    'CCTV15音乐', 'CCTV-15音乐', 'CCTV15音乐频道',
    'CCTV15HD', 'CCTV-15HD', 'CCTV15高清',
    '中央15台', '中央十五台', '中央电视台15',
    'CCTV15(音乐)', 'CCTV-15(音乐)', 'CCTV音乐'
  ],
  
  'CCTV16': [
    'CCTV-16', 'CCTV－16', 'CCTV_16', 'CCTV 16',
    'CCTV16奥林匹克', 'CCTV-16奥林匹克', 'CCTV16奥运',
    'CCTV16HD', 'CCTV-16HD', 'CCTV16高清',
    'CCTV164K', 'CCTV-164K',
    '中央16台', '中央十六台', '中央电视台16',
    'CCTV16(奥林匹克)', 'CCTV-16(奥林匹克)', 'CCTV奥林匹克'
  ],
  
  'CCTV17': [
    'CCTV-17', 'CCTV－17', 'CCTV_17', 'CCTV 17',
    'CCTV17农业农村', 'CCTV-17农业农村', 'CCTV17农业',
    'CCTV17HD', 'CCTV-17HD', 'CCTV17高清',
    '中央17台', '中央十七台', '中央电视台17',
    'CCTV17(农业农村)', 'CCTV-17(农业农村)', 'CCTV农业农村'
  ],
  
  // ========== 省级卫视 ==========
  
  // 湖南卫视
  '湖南卫视': [
    '湖南', '湖南台', '湖南TV', 'HUNAN', 'HUNANTV',
    '湖南卫视HD', '湖南卫视高清', '湖南卫视超清',
    '湖南HD', '湖南高清', '湖南FHD', '湖南4K',
    '湖南卫视(高清)', 'HUNANSTV', '湖南省卫视',
    '湖南卫视1080P', '湖南卫视UHD'
  ],
  
  // 浙江卫视
  '浙江卫视': [
    '浙江', '浙江台', '浙江TV', 'ZHEJIANG', 'ZJTV',
    '浙江卫视HD', '浙江卫视高清', '浙江卫视超清',
    '浙江HD', '浙江高清', '浙江FHD', '浙江4K',
    '浙江卫视(高清)', 'ZHEJIANGTV', '浙江省卫视'
  ],
  
  // 江苏卫视
  '江苏卫视': [
    '江苏', '江苏台', '江苏TV', 'JIANGSU', 'JSTV',
    '江苏卫视HD', '江苏卫视高清', '江苏卫视超清',
    '江苏HD', '江苏高清', '江苏FHD', '江苏4K',
    '江苏卫视(高清)', 'JIANGSUTV', '江苏省卫视'
  ],
  
  // 东方卫视
  '东方卫视': [
    '东方', '东方台', '东方TV', 'DONGFANG', 'DFTV',
    '上海卫视', '上海东方', '上海东方卫视',
    '东方卫视HD', '东方卫视高清', '东方卫视超清',
    '东方HD', '东方高清', '东方FHD', '东方4K',
    '东方卫视(高清)', 'DONGFANGTV', '上海卫视HD'
  ],
  
  // 北京卫视
  '北京卫视': [
    '北京', '北京台', '北京TV', 'BEIJING', 'BJTV',
    '北京卫视HD', '北京卫视高清', '北京卫视超清',
    '北京HD', '北京高清', '北京FHD', '北京4K',
    '北京卫视(高清)', 'BEIJINGTV', 'BTV卫视'
  ],
  
  // 广东卫视
  '广东卫视': [
    '广东', '广东台', '广东TV', 'GUANGDONG', 'GDTV',
    '广东卫视HD', '广东卫视高清', '广东卫视超清',
    '广东HD', '广东高清', '广东FHD', '广东4K',
    '广东卫视(高清)', 'GUANGDONGTV', '广东省卫视'
  ],
  
  // 深圳卫视
  '深圳卫视': [
    '深圳', '深圳台', '深圳TV', 'SHENZHEN', 'SZTV',
    '深圳卫视HD', '深圳卫视高清', '深圳卫视超清',
    '深圳HD', '深圳高清', '深圳FHD', '深圳4K',
    '深圳卫视(高清)', 'SHENZHENTV'
  ],
  
  // 天津卫视
  '天津卫视': [
    '天津', '天津台', '天津TV', 'TIANJIN', 'TJTV',
    '天津卫视HD', '天津卫视高清', '天津卫视超清',
    '天津HD', '天津高清', '天津FHD',
    '天津卫视(高清)', 'TIANJINTV'
  ],
  
  // 山东卫视
  '山东卫视': [
    '山东', '山东台', '山东TV', 'SHANDONG', 'SDTV',
    '山东卫视HD', '山东卫视高清', '山东卫视超清',
    '山东HD', '山东高清', '山东FHD',
    '山东卫视(高清)', 'SHANDONGTV', '山东省卫视'
  ],
  
  // 湖北卫视
  '湖北卫视': [
    '湖北', '湖北台', '湖北TV', 'HUBEI', 'HBTV',
    '湖北卫视HD', '湖北卫视高清', '湖北卫视超清',
    '湖北HD', '湖北高清', '湖北FHD',
    '湖北卫视(高清)', 'HUBEITV', '湖北省卫视'
  ],
  
  // 辽宁卫视
  '辽宁卫视': [
    '辽宁', '辽宁台', '辽宁TV', 'LIAONING', 'LNTV',
    '辽宁卫视HD', '辽宁卫视高清', '辽宁卫视超清',
    '辽宁HD', '辽宁高清', '辽宁FHD',
    '辽宁卫视(高清)', 'LIAONINGTV', '辽宁省卫视'
  ],
  
  // 黑龙江卫视
  '黑龙江卫视': [
    '黑龙江', '黑龙江台', '黑龙江TV', 'HEILONGJIANG', 'HLJTV',
    '黑龙江卫视HD', '黑龙江卫视高清', '黑龙江卫视超清',
    '黑龙江HD', '黑龙江高清', '黑龙江FHD',
    '黑龙江卫视(高清)', 'HEILONGJIANGTV', '黑龙江省卫视'
  ],
  
  // 安徽卫视
  '安徽卫视': [
    '安徽', '安徽台', '安徽TV', 'ANHUI', 'AHTV',
    '安徽卫视HD', '安徽卫视高清', '安徽卫视超清',
    '安徽HD', '安徽高清', '安徽FHD',
    '安徽卫视(高清)', 'ANHUITV', '安徽省卫视'
  ],
  
  // 河北卫视
  '河北卫视': [
    '河北', '河北台', '河北TV', 'HEBEI', 'HEBTV',
    '河北卫视HD', '河北卫视高清', '河北卫视超清',
    '河北HD', '河北高清', '河北FHD',
    '河北卫视(高清)', 'HEBEITV', '河北省卫视'
  ],
  
  // 河南卫视
  '河南卫视': [
    '河南', '河南台', '河南TV', 'HENAN', 'HNTV',
    '河南卫视HD', '河南卫视高清', '河南卫视超清',
    '河南HD', '河南高清', '河南FHD',
    '河南卫视(高清)', 'HENANTV', '河南省卫视'
  ],
  
  // 江西卫视
  '江西卫视': [
    '江西', '江西台', '江西TV', 'JIANGXI', 'JXTV',
    '江西卫视HD', '江西卫视高清', '江西卫视超清',
    '江西HD', '江西高清', '江西FHD',
    '江西卫视(高清)', 'JIANGXITV', '江西省卫视'
  ],
  
  // 四川卫视
  '四川卫视': [
    '四川', '四川台', '四川TV', 'SICHUAN', 'SCTV',
    '四川卫视HD', '四川卫视高清', '四川卫视超清',
    '四川HD', '四川高清', '四川FHD',
    '四川卫视(高清)', 'SICHUANTV', '四川省卫视'
  ],
  
  // 重庆卫视
  '重庆卫视': [
    '重庆', '重庆台', '重庆TV', 'CHONGQING', 'CQTV',
    '重庆卫视HD', '重庆卫视高清', '重庆卫视超清',
    '重庆HD', '重庆高清', '重庆FHD',
    '重庆卫视(高清)', 'CHONGQINGTV'
  ],
  
  // 贵州卫视
  '贵州卫视': [
    '贵州', '贵州台', '贵州TV', 'GUIZHOU', 'GZTV',
    '贵州卫视HD', '贵州卫视高清', '贵州卫视超清',
    '贵州HD', '贵州高清', '贵州FHD',
    '贵州卫视(高清)', 'GUIZHOUTV', '贵州省卫视'
  ],
  
  // 云南卫视
  '云南卫视': [
    '云南', '云南台', '云南TV', 'YUNNAN', 'YNTV',
    '云南卫视HD', '云南卫视高清', '云南卫视超清',
    '云南HD', '云南高清', '云南FHD',
    '云南卫视(高清)', 'YUNNANTV', '云南省卫视'
  ],
  
  // 广西卫视
  '广西卫视': [
    '广西', '广西台', '广西TV', 'GUANGXI', 'GXTV',
    '广西卫视HD', '广西卫视高清', '广西卫视超清',
    '广西HD', '广西高清', '广西FHD',
    '广西卫视(高清)', 'GUANGXITV', '广西省卫视'
  ],
  
  // 吉林卫视
  '吉林卫视': [
    '吉林', '吉林台', '吉林TV', 'JILIN', 'JLTV',
    '吉林卫视HD', '吉林卫视高清', '吉林卫视超清',
    '吉林HD', '吉林高清', '吉林FHD',
    '吉林卫视(高清)', 'JILINTV', '吉林省卫视'
  ],
  
  // 福建卫视
  '福建卫视': [
    '福建', '福建台', '福建TV', 'FUJIAN', 'FJTV', 'SETV',
    '福建卫视HD', '福建卫视高清', '福建卫视超清',
    '福建HD', '福建高清', '福建FHD',
    '福建卫视(高清)', 'FUJIANTV', '福建省卫视', '东南卫视'
  ],
  
  // 陕西卫视
  '陕西卫视': [
    '陕西', '陕西台', '陕西TV', 'SHANXI', 'SXITV',
    '陕西卫视HD', '陕西卫视高清', '陕西卫视超清',
    '陕西HD', '陕西高清', '陕西FHD',
    '陕西卫视(高清)', 'SHANXITV', '陕西省卫视'
  ],
  
  // 山西卫视
  '山西卫视': [
    '山西', '山西台', 'SHANXI3', 'SXSTV',
    '山西卫视HD', '山西卫视高清', '山西卫视超清',
    '山西卫视(高清)', '山西省卫视'
  ],
  
  // 内蒙古卫视
  '内蒙古卫视': [
    '内蒙古', '内蒙古台', '内蒙古TV', 'NEIMENGGU', 'NMGTV',
    '内蒙古卫视HD', '内蒙古卫视高清', '内蒙古卫视超清',
    '内蒙古卫视(高清)', '内蒙古自治区卫视'
  ],
  
  // 青海卫视
  '青海卫视': [
    '青海', '青海台', '青海TV', 'QINGHAI', 'QHTV',
    '青海卫视HD', '青海卫视高清', '青海卫视超清',
    '青海卫视(高清)', '青海省卫视'
  ],
  
  // 宁夏卫视
  '宁夏卫视': [
    '宁夏', '宁夏台', '宁夏TV', 'NINGXIA', 'NXTV',
    '宁夏卫视HD', '宁夏卫视高清', '宁夏卫视超清',
    '宁夏卫视(高清)', '宁夏回族自治区卫视'
  ],
  
  // 新疆卫视
  '新疆卫视': [
    '新疆', '新疆台', '新疆TV', 'XINJIANG', 'XJTV',
    '新疆卫视HD', '新疆卫视高清', '新疆卫视超清',
    '新疆卫视(高清)', '新疆维吾尔自治区卫视'
  ],
  
  // 西藏卫视
  '西藏卫视': [
    '西藏', '西藏台', '西藏TV', 'XIZANG', 'TIBET', 'XZTV',
    '西藏卫视HD', '西藏卫视高清', '西藏卫视超清',
    '西藏卫视(高清)', '西藏自治区卫视'
  ],
  
  // 甘肃卫视
  '甘肃卫视': [
    '甘肃', '甘肃台', '甘肃TV', 'GANSU', 'GSTV',
    '甘肃卫视HD', '甘肃卫视高清', '甘肃卫视超清',
    '甘肃卫视(高清)', '甘肃省卫视'
  ],
  
  // 海南卫视
  '海南卫视': [
    '海南', '海南台', '海南TV', 'HAINAN', 'HNTV2',
    '海南卫视HD', '海南卫视高清', '海南卫视超清',
    '海南卫视(高清)', '海南省卫视', '旅游卫视'
  ],
  
  // ========== 港澳台卫视 ==========
  
  // 凤凰卫视
  '凤凰卫视': [
    '凤凰', '凤凰台', 'PHOENIX', 'PHX',
    '凤凰卫视中文台', '凤凰中文', 'PHOENIXTV',
    '凤凰HD', '凤凰高清'
  ],
  
  '凤凰资讯': [
    '凤凰资讯台', 'PHOENIXINFO', '凤凰资讯HD'
  ],
  
  '凤凰香港': [
    '凤凰香港台', 'PHOENIXHK', '凤凰香港HD'
  ],
  
  // 其他常见频道
  'CHC家庭影院': [
    'CHC家庭', 'CHC影院', 'CHC', 'CHC家庭HD'
  ],
  
  'CHC高清电影': [
    'CHC电影', 'CHC高清', 'CHCTV'
  ],
  
  'CHC动作电影': [
    'CHC动作', 'CHC动作HD'
  ]
};

// [自动处理] 将别名表扁平化以提高查询性能
const FLAT_CHANNELS = {};
for (const [standardName, aliases] of Object.entries(CHANNEL_ALIASES)) {
  FLAT_CHANNELS[standardName.toUpperCase()] = standardName;
  aliases.forEach(alias => {
    // 移除空格并转大写作为索引键
    FLAT_CHANNELS[alias.toUpperCase().replace(/\s+/g, '')] = standardName;
  });
}

/**
 * 频道名标准化清洗工具
 */
function normalizeChannelId(rawCh) {
  if (!rawCh) return "";
  
  // 基础清洗：转大写，去所有空格，去横杠和下划线 (明确保留 + 号)
  const cleanCh = rawCh.toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-_——]/g, '');

  // 1. 尝试直接在扁平映射表中查找
  if (FLAT_CHANNELS[cleanCh]) {
    return FLAT_CHANNELS[cleanCh];
  }

  // 2. 尝试剔除常见后缀后再查找 (保护 CCTV5+，正则不包含 +)
  const baseName = cleanCh.replace(/(HD|SD|高清|超清|4K|8K|综合|频道|台|字幕|分级)$/g, '');
  
  return FLAT_CHANNELS[baseName] || baseName;
}

// [全局内存缓存]
const MEMORY_CACHE_MAP = new Map();
const PENDING_REQUESTS = new Map();

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// =========================================================
// 内部工具：安全读取 query 参数（保留 + 语义）
// =========================================================
function getRawQueryParam(url, ...names) {
  const q = url.search.slice(1);
  for (const name of names) {
    const m = q.match(new RegExp(`(?:^|&)${name}=([^&]*)`));
    if (m) {
      return decodeURIComponent(m[1].replace(/\+/g, '%2B'));
    }
  }
  return null;
}

// =========================================================
// 1. 数据源获取 (底层网络层)
// =========================================================
export async function getSourceStream(ctx, targetUrl, env) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const fetchTimeout = parseInt(env.FETCH_TIMEOUT) || DEFAULT_FETCH_TIMEOUT;
  const maxSourceSize = parseInt(env.MAX_SOURCE_SIZE_BYTES) || DEFAULT_MAX_SOURCE_SIZE;

  const cache = (typeof caches !== 'undefined') ? caches.default : null;
  const cacheKey = new Request(targetUrl, { method: "GET" });
  
  if (cache) {
    let cachedRes = await cache.match(cacheKey);
    if (cachedRes) {
      return {
        stream: cachedRes.body,
        headers: cachedRes.headers,
        isGzip: isGzipContent(cachedRes.headers, targetUrl)
      };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

  try {
    const originRes = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!originRes.ok) throw new Error(`Status ${originRes.status}`);

    const contentLength = originRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > maxSourceSize) {
        throw new Error(`Too large (${contentLength} bytes)`);
    }

    if (cache) {
      const [streamForCache, streamForUse] = originRes.body.tee();
      const responseToCache = new Response(streamForCache, {
        headers: originRes.headers,
        status: originRes.status,
        statusText: originRes.statusText
      });
      
      responseToCache.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
      responseToCache.headers.delete("Vary");
      responseToCache.headers.delete("Set-Cookie");
      responseToCache.headers.set("X-EPG-Fetch-Time", Date.now().toString());

      ctx.waitUntil(cache.put(cacheKey, responseToCache));

      return {
        stream: streamForUse,
        headers: originRes.headers,
        isGzip: isGzipContent(originRes.headers, targetUrl)
      };
    } else {
      return {
        stream: originRes.body,
        headers: originRes.headers,
        isGzip: isGzipContent(originRes.headers, targetUrl)
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error(`Timeout (${fetchTimeout}ms)`);
    throw err;
  }
}

// =========================================================
// 2. 文件下载处理 (XML/GZ)
// =========================================================
export async function handleDownload(ctx, targetFormat, sourceUrl, env) {
  try {
    const source = await getSourceStream(ctx, sourceUrl, env);
    const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
    
    let finalStream = source.stream;
    let contentType = "";

    if (targetFormat === 'xml') {
      contentType = "application/xml; charset=utf-8";
      if (source.isGzip) finalStream = finalStream.pipeThrough(new DecompressionStream('gzip'));
    } else if (targetFormat === 'gz') {
      contentType = "application/gzip";
      if (!source.isGzip) finalStream = finalStream.pipeThrough(new CompressionStream('gzip'));
    }

    return new Response(finalStream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${cacheTtl}`,
        ...CORS_HEADERS
      }
    });
  } catch (e) {
    return new Response(`Download Error: ${e.message}`, { status: 502, headers: CORS_HEADERS });
  }
}

// =========================================================
// 3. DIYP / 超级直播 接口处理 (已优化归一化逻辑)
// =========================================================
export async function handleDiyp(request, url, ctx, env) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const cache = (typeof caches !== 'undefined') ? caches.default : null;
  
  // 获取原始参数并进行标准化清洗
  const rawCh = getRawQueryParam(url, 'ch', 'channel', 'id');
  const ch = normalizeChannelId(rawCh);

  // 构建标准化的 Cache Key，确保不同命名的频道命中同一个缓存
  const normalizedUrl = new URL(url.toString());
  if (ch) normalizedUrl.searchParams.set('ch', ch);
  const cacheKey = new Request(normalizedUrl.toString(), { method: 'GET' });
  
  if (cache) {
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) return cachedResponse;
  }

  let date = url.searchParams.get('date');
  const currentPath = url.pathname;
  
  if (date) {
    const m = date.match(/^DATE(\d+)SUB$/i);
    if (m) {
      const subDays = parseInt(m[1], 10);
      const d = new Date();
      d.setDate(d.getDate() - subDays);
      date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  
  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing params: ch or date" }), {
      headers: { 'content-type': 'application/json', ...CORS_HEADERS }
    });
  }

  // 获取数据
  let result = await fetchAndFind(ctx, env.EPG_URL, ch, date, url.origin, env, currentPath);

  // 备用源逻辑
  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    const backupResult = await fetchAndFind(ctx, env.EPG_URL_BACKUP, ch, date, url.origin, env, currentPath);
    if (backupResult.programs.length > 0) result = backupResult;
  }

  let finalResponse;
  if (result.programs.length === 0) {
    finalResponse = new Response(JSON.stringify({ 
      code: 404, 
      message: "No programs found",
      debug_info: { channel: ch, original_input: rawCh, date: date }
    }), {
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
      status: 404
    });
  } else {
    finalResponse = new Response(JSON.stringify(result.response), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${cacheTtl}`,
        ...CORS_HEADERS
      }
    });

    if (cache) ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  }

  return finalResponse;
}

/**
 * 核心并发与容灾逻辑 (保持不变)
 */
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const errorCooldown = parseInt(env.ERROR_COOLDOWN_MS) || DEFAULT_ERROR_COOLDOWN;
  const maxMemoryCache = parseInt(env.MAX_MEMORY_CACHE_CHARS) || DEFAULT_MAX_MEMORY_CACHE;
  
  const now = Date.now();
  let cachedItem = MEMORY_CACHE_MAP.get(sourceUrl);

  if (cachedItem && cachedItem.lastErrorTime) {
    const elapsed = now - cachedItem.lastErrorTime;
    if (elapsed < errorCooldown) {
      if (cachedItem.text) return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
      return { programs: [], response: {} };
    }
  }

  if (cachedItem && cachedItem.text && now < cachedItem.expireTime) {
    return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
  }

  if (PENDING_REQUESTS.has(sourceUrl)) {
    try {
        const xmlText = await PENDING_REQUESTS.get(sourceUrl);
        return smartFind(xmlText, ch, date, originUrl, currentPath);
    } catch (e) {
        PENDING_REQUESTS.delete(sourceUrl);
    }
  }

  const fetchPromise = (async () => {
    const source = await getSourceStream(ctx, sourceUrl, env);
    let stream = source.stream;
    if (source.isGzip) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  })();

  PENDING_REQUESTS.set(sourceUrl, fetchPromise);

  try {
    const xmlText = await fetchPromise;
    if (xmlText.length < maxMemoryCache) {
        if (MEMORY_CACHE_MAP.size >= 5 && !MEMORY_CACHE_MAP.has(sourceUrl)) {
            const firstKey = MEMORY_CACHE_MAP.keys().next().value;
            MEMORY_CACHE_MAP.delete(firstKey);
        }
        MEMORY_CACHE_MAP.set(sourceUrl, {
            text: xmlText,
            expireTime: now + (cacheTtl * 1000),
            fetchTime: now,
            lastErrorTime: 0,
            errorMsg: null
        });
    }
    return smartFind(xmlText, ch, date, originUrl, currentPath);
  } catch (e) {
    const existing = MEMORY_CACHE_MAP.get(sourceUrl) || {};
    MEMORY_CACHE_MAP.set(sourceUrl, { ...existing, lastErrorTime: now, fetchTime: now, errorMsg: e.message });
    if (existing && existing.text) return smartFind(existing.text, ch, date, originUrl, currentPath);
    return { programs: [], response: {} };
  } finally {
    PENDING_REQUESTS.delete(sourceUrl);
  }
}

/**
 * 获取数据源最后更新时间 (保持不变)
 */
export async function getLastUpdateTimes(env) {
  const mainUrl = env.EPG_URL;
  const backupUrl = env.EPG_URL_BACKUP;
  const cache = (typeof caches !== 'undefined') ? caches.default : null;

  const formatTime = (ts) => {
    if (!ts) return "等待更新";
    const date = new Date(ts);
    return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const getStatus = async (url) => {
     if (!url) return null;
     const item = MEMORY_CACHE_MAP.get(url);
     if (item) {
         const timeStr = formatTime(item.fetchTime);
         if (item.errorMsg) return `${timeStr} <span style="color:red;font-size:0.8em">(${item.errorMsg})</span>`;
         return `${timeStr} <span style="color:green;font-size:0.8em">(Memory)</span>`;
     }
     if (cache) {
         try {
             const cachedRes = await cache.match(new Request(url, { method: "GET" }));
             if (cachedRes) {
                 const ts = cachedRes.headers.get("X-EPG-Fetch-Time");
                 if (ts) return `${formatTime(parseInt(ts))} <span style="color:green;font-size:0.8em">(Edge Cache)</span>`;
             }
         } catch (e) {}
     }
     return "等待调用";
  };

  return {
    main: await getStatus(mainUrl),
    backup: await getStatus(backupUrl)
  };
}
