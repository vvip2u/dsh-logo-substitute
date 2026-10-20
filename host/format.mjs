/**
 * 官方「充值余额」金额渲染（逐字复刻设置→账号与余额 的 formatBalance / addCommas）。
 *
 * 全程按十进制字符串算，绝不经过浮点：12.345 在 IEEE754 下既可能落到 12.34 也可能
 * 落到 12.35，Math.round(12.345*100) 还会给出 12.35，都不可靠。
 *
 * 正负两边**刻意不对称**，这不是 bug，是官方原样行为：
 *   正数 → value.round(2, Big.roundDown)，即向下截断（12.345 → 12.34）；
 *   负数 → value.abs().toFixed(2)，big.js 默认 RM=1（ROUND_HALF_UP），即四舍五入（-12.345 → -12.35）。
 * 别把它「修」成对称的——一改就与设置→账号与余额 的显示永久分叉。
 */

const SYMBOL_BY_CURRENCY = { CNY: '¥', USD: '$' };

/** 非 CNY 一律用美元符号（官方同规则）。 */
export function symbolOf(currency) {
  return SYMBOL_BY_CURRENCY[currency] || '$';
}

// 保留完整小数位，是否小于 0.01 需要看到截断之后的那几位。
function parseDecimal(raw) {
  const text = String(raw == null ? '' : raw).trim().replace(/,/g, '');
  const matched = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  // 脏数据按 0 处理：一个坏钱包不该让整行「充值余额」消失。
  if (!matched) return { negative: false, int: '0', frac: '' };
  return {
    negative: matched[1] === '-',
    int: (matched[2] || '').replace(/^0+/, '') || '0',
    frac: matched[3] || '',
  };
}

function isZero(parts) {
  return parts.int === '0' && !/[1-9]/.test(parts.frac);
}

// 非零且绝对值 < 0.01：整数位为 0，且小数前两位都不是非零。
function isBelowCent(parts) {
  if (parts.int !== '0' || isZero(parts)) return false;
  return /^0*$/.test(parts.frac.slice(0, 2));
}

function truncate2(parts) {
  return { int: parts.int, frac: (parts.frac + '00').slice(0, 2) };
}

// 整数位补一：只做逐位进位，可能连锁（"0" → "1"、"999" → "1000"）。
function incrementDigits(digits) {
  const chars = digits.split('');
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] === '9') {
      chars[index] = '0';
      continue;
    }
    chars[index] = String(Number(chars[index]) + 1);
    return chars.join('');
  }
  return '1' + chars.join('');
}

// 负数分支用的 half-up：对绝对值四舍五入到两位（big.js toFixed 的默认 RM=1）。
// 只看被丢弃的第一位，第三位之后的数字不影响 half-up 的判定。
function roundHalfUp2(parts) {
  const frac = parts.frac + '000';
  let cents = Number(frac.slice(0, 2));
  if (frac.charAt(2) >= '5') cents += 1;
  let intDigits = parts.int;
  if (cents === 100) {
    cents = 0;
    intDigits = incrementDigits(intDigits);
  }
  return intDigits + '.' + String(cents).padStart(2, '0');
}

// 整数部分千分位（英文逗号）+ "." + 两位小数；入参按绝对值处理，正负号由调用方决定。
export function addCommas(amount) {
  const parts = truncate2(parseDecimal(amount));
  return parts.int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts.frac;
}

export function formatBalance(amount, currency) {
  const symbol = symbolOf(currency);
  const parts = parseDecimal(amount);
  if (isZero(parts)) return symbol + '0.00';
  // 负数走 half-up（见文件头注释）；"0.01" 特例对应官方的 value.gt(-.01)。
  if (parts.negative) return '-' + symbol + (isBelowCent(parts) ? '0.01' : addCommas(roundHalfUp2(parts)));
  if (isBelowCent(parts)) return '<' + symbol + '0.01';
  return symbol + addCommas(amount);
}
