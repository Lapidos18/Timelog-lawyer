
'use client'
import { useState, useMemo } from 'react'
import { Info, Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'

function fmt2(n: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
type Mode = 'net_to_gross' | 'gross_to_net'

export default function CalculatorTab() {
  const [mode, setMode] = useState<Mode>('net_to_gross')
  const [amount, setAmount] = useState('40000')
  const [rate, setRate] = useState('0.15')
  const [monthlyExpenses, setMonthlyExpenses] = useState('9600')
  const [copied, setCopied] = useState(false)

  const rateNum = parseFloat(rate) || 0
  const amountNum = parseFloat(amount) || 0
  const expensesNum = parseFloat(monthlyExpenses) || 0

  const calc = useMemo(() => {
    if (mode === 'net_to_gross') {
      // Хочу получить "на руки" amountNum -> сколько выставить
      const baseNoDeduction = amountNum / (1 - rateNum)
      const ndflNoDeduction = baseNoDeduction * rateNum
      const netCheckNoDeduction = baseNoDeduction - ndflNoDeduction

      const baseWithDeduction = (amountNum - expensesNum * rateNum) / (1 - rateNum)
      const ndflWithDeduction = baseWithDeduction * rateNum
      const netCheckWithDeduction = baseWithDeduction - ndflWithDeduction

      return {
        noDeduction: { gross: baseNoDeduction, ndfl: ndflNoDeduction, net: netCheckNoDeduction },
        withDeduction: { gross: baseWithDeduction, ndfl: ndflWithDeduction, net: netCheckWithDeduction },
      }
    } else {
      // Получил доход amountNum -> сколько НДФЛ и сколько останется на руки
      const ndflNoDeduction = amountNum * rateNum
      const netNoDeduction = amountNum - ndflNoDeduction

      const taxBaseWithDeduction = Math.max(0, amountNum - expensesNum)
      const ndflWithDeduction = taxBaseWithDeduction * rateNum
      const netWithDeduction = amountNum - ndflWithDeduction

      return {
        noDeduction: { gross: amountNum, ndfl: ndflNoDeduction, net: netNoDeduction },
        withDeduction: { gross: amountNum, ndfl: ndflWithDeduction, net: netWithDeduction },
      }
    }
  }, [mode, amountNum, rateNum, expensesNum])

  function copyActText() {
    const sum = calc.withDeduction.gross
    const ndfl = calc.withDeduction.ndfl
    const ratePct = Math.round(rateNum * 100)
    const text = `Вознаграждение Адвоката составляет ${fmt2(sum)} (${numberToWordsRu(Math.round(sum))}) руб., в т.ч. НДФЛ (${ratePct}%) — ${fmt2(ndfl)} руб., уплачиваемый Адвокатом самостоятельно в соответствии с пп. 2 п. 1 ст. 227 НК РФ.`
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Текст скопирован')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <p className="text-sm text-navy-500 mb-5">
        Разовый расчёт: сколько выставить, чтобы получить нужную сумму «на руки», или сколько НДФЛ удержится
        с уже полученного дохода (пп. 2 п. 1 ст. 227 НК РФ). Для годового расчёта нарастающим итогом — вкладка «Расчёт НДФЛ».
      </p>

      {/* Mode switch */}
      <div className="card mb-5">
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setMode('net_to_gross')}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
              mode === 'net_to_gross'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-800 text-navy-400 hover:text-navy-200'
            }`}
          >
            Хочу получить «на руки» → сколько выставить
          </button>
          <button
            onClick={() => setMode('gross_to_net')}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors ${
              mode === 'gross_to_net'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-800 text-navy-400 hover:text-navy-200'
            }`}
          >
            Получил доход → сколько НДФЛ и на руки
          </button>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">
              {mode === 'net_to_gross' ? 'Хочу получить «на руки»' : 'Сумма дохода (начислено)'}
            </label>
            <div className="relative">
              <input
                type="number"
                className="input pr-10"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="40000"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-500 text-sm">₽</span>
            </div>
          </div>
          <div>
            <label className="label">Ставка НДФЛ</label>
            <select className="select" value={rate} onChange={e => setRate(e.target.value)}>
              <option value="0.13">13% (доход ≤ 2,4 млн ₽/год)</option>
              <option value="0.15">15% (доход &gt; 2,4 млн ₽/год)</option>
            </select>
          </div>
          <div>
            <label className="label">
              Ежемесячные расходы кабинета
              <span className="ml-1 text-navy-600 normal-case font-normal">(для профвычета)</span>
            </label>
            <div className="relative">
              <input
                type="number"
                className="input pr-10"
                value={monthlyExpenses}
                onChange={e => setMonthlyExpenses(e.target.value)}
                placeholder="9600"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-500 text-sm">₽</span>
            </div>
          </div>
        </div>
      </div>

      {/* Results: two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* Without deduction */}
        <div className="card">
          <h2 className="text-sm font-semibold text-navy-300 mb-4 pb-3 border-b border-navy-800">
            Без профессионального вычета
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-navy-500">
                {mode === 'net_to_gross' ? 'Сумма к выставлению' : 'Начислено'}
              </span>
              <span className="text-lg font-semibold text-navy-100">{fmt2(calc.noDeduction.gross)} ₽</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-navy-500">НДФЛ ({Math.round(rateNum*100)}%)</span>
              <span className="text-base font-medium text-red-400">{fmt2(calc.noDeduction.ndfl)} ₽</span>
            </div>
            <div className="flex justify-between items-baseline pt-3 border-t border-navy-800">
              <span className="text-sm text-navy-400 font-medium">На руки</span>
              <span className="text-xl font-bold text-emerald-400">{fmt2(calc.noDeduction.net)} ₽</span>
            </div>
          </div>
        </div>

        {/* With deduction */}
        <div className="card border-gold-800/40">
          <h2 className="text-sm font-semibold text-gold-400 mb-4 pb-3 border-b border-navy-800 flex items-center gap-1.5">
            С профессиональным вычетом (ст. 221 НК РФ)
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-navy-500">
                {mode === 'net_to_gross' ? 'Сумма к выставлению' : 'Начислено'}
              </span>
              <span className="text-lg font-semibold text-navy-100">{fmt2(calc.withDeduction.gross)} ₽</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-navy-500">Вычет (расходы)</span>
              <span className="text-base font-medium text-navy-400">{fmt2(expensesNum)} ₽</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-navy-500">НДФЛ ({Math.round(rateNum*100)}%)</span>
              <span className="text-base font-medium text-red-400">{fmt2(calc.withDeduction.ndfl)} ₽</span>
            </div>
            <div className="flex justify-between items-baseline pt-3 border-t border-navy-800">
              <span className="text-sm text-navy-400 font-medium">На руки</span>
              <span className="text-xl font-bold text-emerald-400">{fmt2(calc.withDeduction.net)} ₽</span>
            </div>
          </div>
        </div>
      </div>

      {/* Act formula */}
      <div className="card mb-5 bg-navy-900/60">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-navy-300">Формулировка для акта (с профвычетом)</h2>
          <button onClick={copyActText} className="btn-secondary text-xs">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Скопировано' : 'Копировать'}
          </button>
        </div>
        <p className="text-sm text-navy-400 leading-relaxed">
          Вознаграждение Адвоката составляет <span className="text-gold-400 font-medium">{fmt2(calc.withDeduction.gross)} руб.</span>,
          в т.ч. НДФЛ ({Math.round(rateNum*100)}%) — <span className="text-gold-400 font-medium">{fmt2(calc.withDeduction.ndfl)} руб.</span>,
          уплачиваемый Адвокатом самостоятельно в соответствии с пп. 2 п. 1 ст. 227 НК РФ.
        </p>
      </div>

      {/* Reference */}
      <div className="card bg-navy-900/40">
        <h2 className="text-xs font-medium text-navy-400 mb-3 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> Ставки и справочник
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs text-navy-500">
          <div className="flex justify-between border-b border-navy-800/50 py-1.5">
            <span>Ставка 13%</span>
            <span className="text-navy-400">доход ≤ 2 400 000 ₽/год</span>
          </div>
          <div className="flex justify-between border-b border-navy-800/50 py-1.5">
            <span>Ставка 15%</span>
            <span className="text-navy-400">доход &gt; 2 400 000 ₽/год</span>
          </div>
          <div className="flex justify-between border-b border-navy-800/50 py-1.5">
            <span>Профвычет</span>
            <span className="text-navy-400 text-right">взносы в палату + РКО + страх. взносы</span>
          </div>
          <div className="flex justify-between border-b border-navy-800/50 py-1.5">
            <span>Фикс. взносы СФР</span>
            <span className="text-navy-400">57 390 ₽/год · ≈4 783 ₽/мес</span>
          </div>
          <div className="flex justify-between border-b border-navy-800/50 py-1.5">
            <span>Взносы в палату</span>
            <span className="text-navy-400">≈1 700 ₽/мес</span>
          </div>
          <div className="flex justify-between border-b border-navy-800/50 py-1.5">
            <span>РКО (банк)</span>
            <span className="text-navy-400">≈1 500 ₽/мес</span>
          </div>
          <div className="flex justify-between py-1.5 md:col-span-2">
            <span>1% ОПС</span>
            <span className="text-navy-400 text-right">1% от дохода свыше 300 000 ₽ — не включается в ежемесячный расход</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Простое число прописью (для актов до ~9 999 999)
function numberToWordsRu(num: number): string {
  if (num === 0) return 'ноль'
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const onesF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать']
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']

  function triple(n: number, fem: boolean): string {
    const parts: string[] = []
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10
    if (h) parts.push(hundreds[h])
    if (t === 1) parts.push(teens[o])
    else {
      if (t) parts.push(tens[t])
      if (o) parts.push(fem ? onesF[o] : ones[o])
    }
    return parts.join(' ')
  }

  const millions = Math.floor(num / 1000000)
  const thousands = Math.floor((num % 1000000) / 1000)
  const rest = num % 1000

  const out: string[] = []
  if (millions) {
    out.push(triple(millions, false))
    const m = millions % 100
    if (m >= 11 && m <= 14) out.push('миллионов')
    else if (millions % 10 === 1) out.push('миллион')
    else if ([2,3,4].includes(millions % 10)) out.push('миллиона')
    else out.push('миллионов')
  }
  if (thousands) {
    out.push(triple(thousands, true))
    const t = thousands % 100
    if (t >= 11 && t <= 14) out.push('тысяч')
    else if (thousands % 10 === 1) out.push('тысяча')
    else if ([2,3,4].includes(thousands % 10)) out.push('тысячи')
    else out.push('тысяч')
  }
  if (rest || (!millions && !thousands)) out.push(triple(rest, false))

  return out.filter(Boolean).join(' ')
}
