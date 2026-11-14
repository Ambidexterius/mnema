import type {Finding} from './types.ts';

/** The review status does not change a finding's author or origin. */
export function findingStatusLabel(finding:Pick<Finding,'status'|'origin'>):string{
 if(finding.status==='verified')return 'Проверено';
 if(finding.status==='rejected')return 'Отклонено';
 return finding.origin==='ai'?'Предложено ИИ':'Ждёт проверки';
}
