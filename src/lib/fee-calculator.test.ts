import { describe,it,expect } from 'vitest'
import { calculateFee,calculatorAmount } from './fee-calculator'
describe('разовый расчёт',()=>{
 it('не создаёт отрицательный налог при вычете больше дохода',()=>{expect(calculateFee(1000,2000,.15,true)).toEqual({gross:1000,ndfl:0,net:1000})})
 it('согласует прямой и обратный расчёты до копейки',()=>{for(const rate of [.13,.15,.18,.2,.22])for(const target of [0,.01,999.99,2000,40000.27])for(const deduction of [0,2000,9600]){const r=calculateFee(target,deduction,rate,true);expect(r.ndfl).toBeGreaterThanOrEqual(0);expect(r.net).toBe(target);expect(calculateFee(r.gross,deduction,rate,false)).toEqual(r)}})
 it('проверяет ввод и запятую',()=>{expect(calculatorAmount('1 234,56')).toBe(1234.56);for(const x of ['-1','NaN','1abc','1.234','Infinity','1e3'])expect(calculatorAmount(x)).toBeNull();expect(()=>calculateFee(1,0,1,true)).toThrow()})
})
