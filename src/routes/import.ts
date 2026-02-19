import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { domainSchema } from '../config/schema.js';
import { addDomain, domainExists } from '../database/domains.js';
import { getGroupByName, createGroup } from '../database/groups.js';
import { getOrCreateTag, addTagToDomain } from '../database/tags.js';
import { logAudit, auditImport } from '../database/audit.js';
import { db } from '../database/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createLogger } from '../utils/logger.js';
import type { CSVImportResult } from '../types/api.js';

const router = Router();
const logger = createLogger('import');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

// Import domains from CSV
router.post(
  '/csv',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const content = req.file.buffer.toString('utf-8');

    let records: Record<string, string>[];
    try {
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse CSV';
      return res.status(400).json({ success: false, message: `Invalid CSV format: ${message}` });
    }

    if (records.length > 500) {
      return res.status(400).json({
        success: false,
        message: `CSV file contains ${records.length} rows. Maximum allowed is 500.`,
      });
    }

    const result: CSVImportResult = { imported: 0, skipped: 0, errors: [] };
    const groupCache = new Map<string, number>();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 2; // +2 for header row and 1-based indexing

      try {
        // Get domain from various possible column names
        const rawDomain = record.domain || record.Domain || record.DOMAIN || record.name || record.Name;
        if (!rawDomain) {
          result.errors.push(`Row ${rowNum}: Missing domain column`);
          result.skipped++;
          continue;
        }

        // Validate domain
        let domain: string;
        try {
          domain = domainSchema.shape.domain.parse(rawDomain);
        } catch {
          result.errors.push(`Row ${rowNum}: Invalid domain format "${rawDomain}"`);
          result.skipped++;
          continue;
        }

        // Check for duplicate
        if (domainExists(domain)) {
          result.skipped++;
          continue;
        }

        // Handle group
        let groupId: number | null = null;
        const groupName = record.group || record.Group || record.GROUP;
        if (groupName) {
          if (groupCache.has(groupName.toLowerCase())) {
            groupId = groupCache.get(groupName.toLowerCase())!;
          } else {
            const existing = getGroupByName(groupName);
            if (existing) {
              groupId = existing.id!;
            } else {
              groupId = createGroup({ name: groupName, color: '#6366f1' });
            }
            groupCache.set(groupName.toLowerCase(), groupId);
          }
        }

        // Add domain and its tags atomically
        const tagsStr = record.tags || record.Tags || record.TAGS;
        db.transaction(() => {
          const domainId = addDomain({
            domain,
            registrar: record.registrar || record.Registrar || '',
            created_date: '',
            expiry_date: '',
            name_servers: [],
            name_servers_prev: [],
            last_checked: null,
            error: null,
            group_id: groupId,
          });

          if (tagsStr) {
            const tagNames = tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean);
            for (const tagName of tagNames) {
              const tagId = getOrCreateTag(tagName);
              addTagToDomain(domainId, tagId);
            }
          }
        })();

        result.imported++;

        logAudit({
          entity_type: 'domain',
          entity_id: domain,
          action: 'import',
          new_value: { domain, groupId, source: 'csv' },
          ip_address: req.ip,
          user_agent: req.get('User-Agent'),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Row ${rowNum}: ${message}`);
        result.skipped++;
      }
    }

    logger.info('CSV import completed', { imported: result.imported, skipped: result.skipped, errors: result.errors.length });

    // Log bulk import to audit
    if (result.imported > 0) {
      auditImport(result.imported, result.skipped, req.ip, req.get('User-Agent'));
    }

    res.json({ success: true, ...result });
  })
);

// Download CSV template
router.get(
  '/template',
  asyncHandler(async (_req, res) => {
    const template = 'domain,group,tags\nexample.com,Production,"important,client-a"\nanother.com,Development,internal\n';

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=domains_template.csv');
    res.send(template);
  })
);

export default router;
