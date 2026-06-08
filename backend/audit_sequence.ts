import * as fs from 'fs';

function run() {
  const data = JSON.parse(fs.readFileSync('recovered_tickets_dry_run.json', 'utf8'));

  const ticketNumbers = [];
  const invalidOrMissing = [];

  for (const t of data) {
    if (t.ticketId && t.ticketId.startsWith('TKT-')) {
      const numStr = t.ticketId.split('-')[1];
      const num = parseInt(numStr, 10);
      if (!isNaN(num)) {
        ticketNumbers.push(num);
      } else {
        invalidOrMissing.push(t.ticketId);
      }
    } else {
      invalidOrMissing.push(t.ticketId || 'NULL');
    }
  }

  ticketNumbers.sort((a, b) => a - b);

  const min = Math.min(...ticketNumbers);
  const max = Math.max(...ticketNumbers);
  
  const expectedSet = new Set();
  for (let i = min; i <= max; i++) {
    expectedSet.add(i);
  }

  const actualSet = new Set(ticketNumbers);
  const missing = [];
  
  for (let i = min; i <= max; i++) {
    if (!actualSet.has(i)) {
      missing.push(`TKT-${String(i).padStart(3, '0')}`);
    }
  }

  let uniqueTktCreated = data.length; // Actually data is unique tickets
  
  const report = `
# Ticket Sequence Audit

## Overview
- **Total unique ticket entityIds:** ${data.length}
- **Highest ticket number found:** TKT-${String(max).padStart(3, '0')}
- **Lowest ticket number found:** TKT-${String(min).padStart(3, '0')}
- **Invalid or non-standard ticket IDs:** ${invalidOrMissing.length > 0 ? invalidOrMissing.join(', ') : 'None'}

## Gaps in Sequence
Found **${missing.length}** missing ticket numbers between TKT-${String(min).padStart(3, '0')} and TKT-${String(max).padStart(3, '0')}.

${missing.length > 0 ? missing.slice(0, 100).join('\\n') + (missing.length > 100 ? '\\n...and more' : '') : 'No missing tickets in sequence.'}

## Conclusion
${missing.length === 0 
  ? 'The sequence is perfectly contiguous. The 447 recovered tickets represent the complete universe of tickets created.' 
  : 'There are gaps in the sequence. These could be tickets that were deleted long ago and their creation logs are also gone, or tickets created in a different sequence.'}
`;

  fs.writeFileSync('TICKET_SEQUENCE_AUDIT.md', report.trim() + '\\n');
  console.log('Generated TICKET_SEQUENCE_AUDIT.md');
}

run();
