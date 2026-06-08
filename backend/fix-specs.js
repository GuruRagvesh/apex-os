const fs = require('fs');
const path = require('path');

const mockProvider = `{ provide: TVAService, useValue: { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyNow: () => new Date(), companyDayStart: () => new Date(), formatZoned: () => 'mock' } },`;

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.spec.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      if (content.includes('Test.createTestingModule') && content.includes('providers: [')) {
        if (!content.includes('provide: TVAService')) {
           content = content.replace(/providers:\s*\[/, 'providers: [\n        ' + mockProvider);
           
           // We need to import TVAService
           if (!content.includes('import { TVAService }')) {
             // Let's figure out relative path to src/common/services/tva.service
             // For simplicity, just use an absolute path trick if it's jest, or count depth.
             // But actually we can just insert a generic import depending on if it's in test/ or src/
             let relativePath = '';
             if (fullPath.includes('test\\unit') || fullPath.includes('test/unit')) {
               relativePath = '../../src/common/services/tva.service';
             } else if (fullPath.includes('test\\integration') || fullPath.includes('test/integration')) {
               relativePath = '../../src/common/services/tva.service';
             } else {
               // In src/
               const depth = fullPath.split('src')[1].split(path.sep).length - 2;
               relativePath = '../'.repeat(depth) + 'common/services/tva.service';
             }
             content = `import { TVAService } from '${relativePath}';\n` + content;
           }

           fs.writeFileSync(fullPath, content);
           console.log(`Patched ${fullPath}`);
        }
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
processDir(path.join(__dirname, 'test'));
