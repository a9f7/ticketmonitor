// Trip.com 机票接口封装（纯 HTTP，无需浏览器）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CID = '09034150315547864259';
const VID = '1785427770013.2017uQ8F8qQC';

function baseHeaders(ref) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    'Origin': 'https://www.trip.com',
    'Referer': ref || 'https://www.trip.com/flights/',
    'currency': 'CNY',
    'locale': 'zh-CN',
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

async function post(url, payload, ref, timeoutMs = 45000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: baseHeaders(ref),
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** 往返低价日历：返回 [{dep,ret,price}] */
async function lowPriceCalendar(dCity, aCity, dDate, aDate) {
  const payload = {
    dCity, aCity, dDate, aDate,
    flightWayType: 'RT',
    departureAirport: '', arrivalAirport: '',
    cabinClass: 'Economy', transferType: 'ANY',
    searchInfo: { travelerNum: { adult: 1, child: 0, infant: 0 } },
    abtList: [], offSet: 30, startInterval: 0, endInterval: 30,
    searchMode: 'Compare',
    Head: {
      Group: 'Trip', Source: 'ONLINE', Version: '3', Currency: 'CNY', Locale: 'zh-CN',
      VID, SessionId: '1', PvId: '1',
      AllianceInfo: { AllianceID: 0, SID: 0, OuID: '', UseDistributionType: 1 },
      TransactionID: '1-mf-' + Date.now() + '-node',
      ExtendFields: { PageId: '10320667454', Os: 'Windows', OsVersion: '10', SpecialSupply: '', BatchedId: 'b-' + Date.now(), flightsignature: '' },
      ClientID: CID,
    },
  };
  const d = await post('https://www.trip.com/restapi/soa2/14427/GetLowPriceInCalender', payload,
    `https://www.trip.com/flights/showfarefirst?dcity=${dCity.toLowerCase()}&acity=${aCity.toLowerCase()}`);
  const list = d.lowPriceInCalenderDtoInfoList || [];
  const fmt = (ts) => {
    const dt = new Date(ts * 1000);
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  };
  return list.filter(x => x.currencyPrice > 0).map(x => ({ dep: fmt(x.dDate), ret: fmt(x.aDate), price: x.currencyPrice }));
}

/** 往返航班列表 */
async function flightList(dCity, aCity, depDate, retDate) {
  const payload = {
    mode: 0,
    searchCriteria: {
      grade: 1, realGrade: 1, tripType: 2, journeyNo: 1,
      passengerInfoType: { adultCount: 1, childCount: 0, infantCount: 0 },
      journeyInfoTypes: [
        { journeyNo: 1, departDate: depDate, departCode: dCity, arriveCode: aCity, departAirport: '', arriveAirport: '' },
        { journeyNo: 2, departDate: retDate, departCode: aCity, arriveCode: dCity, departAirport: '', arriveAirport: '' },
      ],
      policyId: null,
    },
    sortInfoType: { direction: true, orderBy: 'Price', topList: [] },
    tagList: [], flagList: ['NEED_RESET_SORT', 'FullDataCache'],
    filterType: { filterFlagTypes: [], queryItemSettings: [], studentsSelectedStatus: true },
    abtList: [],
    head: {
      cid: CID, ctok: '', cver: '3', lang: '01', sid: '8888', syscode: '40', auth: '', xsid: '',
      extension: [
        { name: 'source', value: 'ONLINE' }, { name: 'sotpGroup', value: 'Trip' },
        { name: 'sotpLocale', value: 'zh-CN' }, { name: 'sotpCurrency', value: 'CNY' },
        { name: 'allianceID', value: '0' }, { name: 'sid', value: '0' }, { name: 'ouid', value: '' },
        { name: 'useDistributionType', value: '1' },
        { name: 'flt_app_session_transactionId', value: '1-mf-' + Date.now() + '-WEB' },
        { name: 'vid', value: VID }, { name: 'pvid', value: '1' }, { name: 'Flt_SessionId', value: '1' },
        { name: 'x-ua', value: 'v=3_os=ONLINE_osv=10' }, { name: 'PageId', value: '10320667454' },
        { name: 'clientTime', value: new Date().toISOString() },
        { name: 'Flt_BatchId', value: 'b-' + Date.now() },
        { name: 'BlockTokenTimeout', value: '0' },
        { name: 'full_link_time_scene', value: 'pure_list_page' },
        { name: 'xproduct', value: 'baggage' }, { name: 'hotelEntrance', value: 'Flight' },
        { name: 'units', value: 'METRIC' }, { name: 'sotpUnit', value: 'METRIC' },
      ],
      Locale: 'zh-CN', Language: 'zh', Currency: 'CNY', ClientID: '', appid: '700020',
    },
  };
  return await post('https://www.trip.com/restapi/soa2/27015/FlightListSearch', payload,
    `https://www.trip.com/flights/showfarefirst?dcity=${dCity.toLowerCase()}&acity=${aCity.toLowerCase()}`, 60000);
}

module.exports = { lowPriceCalendar, flightList };
