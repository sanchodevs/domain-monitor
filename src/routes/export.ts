import { Router } from 'express';
import { getAllDomains } from '../database/domains.js';
import { getTagsForDomain } from '../database/tags.js';
import { getGroupById } from '../database/groups.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { escapeCSV, calculateAge, getExpiryDays, generateTimestamp } from '../utils/helpers.js';

const router = Router();

// Export domains to CSV
router.get(
  '/csv',
  asyncHandler(async (_req, res) => {
    const domains = getAllDomains();

    const headers = [
      'Domain',
      'Registrar',
      'Created',
      'Age',
      'Expires',
      'Days Left',
      'Name Servers',
      'Group',
      'Tags',
      'Last Checked',
      'Status',
    ];

    const rows = domains.map((d) => {
      const created = d.created_date ? new Date(d.created_date) : null;
      const expiry = d.expiry_date ? new Date(d.expiry_date) : null;
      const status = d.error ? 'Error' : 'OK';

      // Get group name
      const group = d.group_id ? getGroupById(d.group_id) : null;

      // Get tags
      const tags = d.id ? getTagsForDomain(d.id).map((t) => t.name) : [];

      return [
        escapeCSV(d.domain),
        escapeCSV(d.registrar),
        escapeCSV(created?.toISOString() || ''),
        escapeCSV(calculateAge(d.created_date)),
        escapeCSV(expiry?.toISOString() || ''),
        escapeCSV(getExpiryDays(d.expiry_date) ?? ''),
        escapeCSV((d.name_servers || []).join('|')),
        escapeCSV(group?.name || ''),
        escapeCSV(tags.join(',')),
        escapeCSV(d.last_checked || ''),
        escapeCSV(status),
      ].join(',');
    });

    const bom = '\uFEFF'; // UTF-8 BOM for Excel compatibility
    const timestamp = generateTimestamp();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=domains_${timestamp}.csv`);
    res.send(bom + headers.join(',') + '\r\n' + rows.join('\r\n'));
  })
);

// Export domains to JSON
router.get(
  '/json',
  asyncHandler(async (_req, res) => {
    const domains = getAllDomains();

    const data = domains.map((d) => {
      const group = d.group_id ? getGroupById(d.group_id) : null;
      const tags = d.id ? getTagsForDomain(d.id) : [];

      return {
        ...d,
        group: group ? { id: group.id, name: group.name } : null,
        tags: tags.map((t) => ({ id: t.id, name: t.name })),
      };
    });

    const timestamp = generateTimestamp();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=domains_${timestamp}.json`);
    res.json(data);
  })
);

export default router;
