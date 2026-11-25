"""Derive compact evidence and a Japanese report from the disposable API trace."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
REPO = Path(sys.argv[2]).resolve()
data = json.loads((ROOT / 'comparison.json').read_text())

def point(value):
    if value.get('kind') == 'at':
        p = value['point']
        return f"{json.loads(p['domainId'])[1]} cell{p['cell']}"
    return json.dumps(value, ensure_ascii=False)

def action(a):
    return {k: a.get(k) for k in ['actorName', 'source', 'start', 'startClock', 'end', 'endClock', 'elapsed', 'endKind', 'metrics', 'startPosition', 'endPosition', 'startNeeds', 'endNeeds', 'memories', 'task', 'bedCandidatesAtMinuteStart', 'reservationsAtMinuteStart']}

def pending(a):
    t = a['task']
    return {'name': a['name'], 'position': a['position'], 'needs': a['needs'], 'metrics': a['metrics'], 'task': t}

summary = {
    'runContext': data['runContext'], 'originHash': data['originHash'],
    'origin': data['origin'], 'branches': {}, 'alternatives': [],
    'sleepChoiceChecks': {k: v for k, v in data['sleeping'].items() if k != 'proof'},
    'daily': {}, 'checks': data['checks'],
    'scope': '公開本体APIによる制御再現とUIコード読取り。製品コード変更・UI操作・個人セーブ利用なし。',
}

checkpoints = []
for label, branch in data['branches'].items():
    assert branch['morning']['time'] - data['origin']['time'] == 1440
    for a in branch['morning']['actors']:
        assert sum(a['metrics'].values()) == 1440
    wood = [{'clock': minute['clock'], 'quantity': minute['stockDelta']['wood']}
            for minute in branch['minuteLog'] if minute['stockDelta']['wood'] > 0]
    total = sum(e['quantity'] for e in wood)
    assert 18 - branch['furnitureWood'] - branch['constructionWood'] + total == branch['morning']['stock']['wood']
    summary['branches'][label] = {
        'control': branch['control'], 'woodFlow': {
            'initial': 18, 'furnitureCost': branch['furnitureWood'],
            'constructionCost': branch['constructionWood'], 'woodProduced': total,
            'final': branch['morning']['stock']['wood'], 'productionEvents': wood,
        },
        'beforeRead': branch['beforeRead'], 'geometryAtReading': branch['geometryAtReading'],
        'reading': {name: action(branch['directedReading'][name]) for name in ['kaya', 'sui']},
        'bothReadingsDoneAt': branch['directedReading']['bothDone']['clock'],
        'autoAlternativeAtRejection': branch['automaticAlternativeAfterRejection'],
        'morningStock': branch['morning']['stock'],
        'morningTasks': [pending(a) for a in branch['morning']['actors']],
        'oneMinuteLaterStock': branch['oneMinuteLater']['stock'],
        'orders': [{k: a.get(k) for k in ['sequence', 'time', 'clock', 'actorId', 'kind', 'target', 'label', 'accepted', 'preview', 'inspectionReadOnly', 'rejectionPreservedTaskAndState']} for a in branch['attempts']],
        'nextCompletionCheck': [e for e in branch['events'] if e['label'] == 'next-completion-time-forward-from-first-reading'],
    }
    checkpoints += [{'scenario': label, **check} for check in branch['checkpoints']]
for alternative in data['alternatives']:
    summary['alternatives'].append({
        'name': alternative['name'], 'directedAction': action(alternative['directedAction']),
        'totalExplicitWaiting': sum(a['metrics']['waiting'] for a in alternative['actions']),
        'note': alternative['note'],
    })
daily = data['daily']
for a in daily['morning']['actors']:
    assert sum(a['metrics'].values()) == 1440
summary['daily'] = {
    'control': daily['controlledSchedule'], 'caution': daily['caution'],
    'beforeRest': daily['beforeRest'], 'bedUses': [action(a) for a in daily['bedUses']],
    'morningStock': daily['morning']['stock'],
    'morningTasks': [pending(a) for a in daily['morning']['actors']],
    'orders': [{k: a.get(k) for k in ['sequence', 'clock', 'actorId', 'kind', 'target', 'label', 'accepted', 'preview']} for a in daily['attempts']],
}
checkpoints += [{'scenario': 'daily', **check} for check in daily['checkpoints']]
checkpoints += [{'scenario': 'bed-nearness', **check} for check in data['sleeping']['proof']['checkpoints']]
summary['checkpoints'] = checkpoints
summary['checkCount'] = len(checkpoints)
summary['allScenarioMinuteTotalsEqual1440'] = True
(ROOT / 'comparison-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')

source_paths = list((REPO / 'src/reform').rglob('*.ts')) + list((REPO / 'src/reform').rglob('*.tsx'))
artifacts = ['comparison.json', 'comparison-summary.json', 'generated-origin-slot.json', 'generated-daily-start-slot.json', 'generated-daily-after-night-slot.json']
manifest = {
    'sourceRoot': str(REPO),
    'sourceCommit': data['runContext']['productLocalCommit'],
    'sourceSha256': {str(p.relative_to(REPO)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(source_paths)},
    'artifactSha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in artifacts if (ROOT / name).exists()},
}
(ROOT / 'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'checkpointCount': len(checkpoints), 'branches': {k: {'bothDone': v['bothReadingsDoneAt'], 'stock': v['morningStock'], 'oneMinuteLater': v['oneMinuteLaterStock']} for k,v in summary['branches'].items()}}, ensure_ascii=False, indent=2))
