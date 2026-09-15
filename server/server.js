import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { analyzeWaste } from './services/ai.js';
import { getUserFromToken, isSupabaseConfigured, publicSupabaseConfig, supabaseAdmin } from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');
const app = express();
const port = Number(process.env.PORT || 3000);

const statuses = ['submitted', 'pending', 'accepted', 'assigned', 'cleaning', 'cleaned', 'declined'];
const activeStatuses = ['submitted', 'pending', 'accepted', 'assigned', 'cleaning'];
const starterMarketplaceListings = [
  {
    title: '100 clean cardboard boxes',
    description: 'Flattened moving boxes ready for collection and reuse by a shop, school, or recycler.',
    category: 'Cardboard', quantity: '100 boxes', listing_type: 'bulk', condition: 'Clean and reusable', price: 2500, location: 'Colombo 05',
    image_urls: ['https://images.unsplash.com/photo-1607166452427-7e4477079cb9?auto=format&fit=crop&w=1200&q=80'],
  },
  {
    title: 'Reusable plastic chairs',
    description: 'A set of sturdy plastic chairs suitable for events, classrooms, or community spaces.',
    category: 'Furniture', quantity: '12 chairs', listing_type: 'bulk', condition: 'Used, good condition', price: 7200, location: 'Nugegoda',
    image_urls: ['https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=1200&q=80'],
  },
  {
    title: 'Glass storage containers',
    description: 'Washed glass containers with lids, ready for pantry storage or creative reuse.',
    category: 'Glass', quantity: '8 containers', listing_type: 'individual', condition: 'Clean, lightly used', price: 350, location: 'Maharagama',
    image_urls: ['https://images.unsplash.com/photo-1523293836415-599cbbe0d9e9?auto=format&fit=crop&w=1200&q=80'],
  },
  {
    title: 'Sorted scrap metal',
    description: 'Mixed aluminium and steel offcuts sorted for recycling and available as one lot.',
    category: 'Metal', quantity: 'Approx. 30 kg', listing_type: 'bulk', condition: 'Sorted for recycling', price: 4800, location: 'Dehiwala',
    image_urls: ['https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=1200&q=80'],
  },
];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 5 },
  fileFilter: (_request, file, callback) => {
    callback(null, /^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype));
  },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

const badRequest = (response, message) => response.status(400).json({ error: message });
const unavailable = (response) => response.status(503).json({ error: 'Supabase is not configured. Add your server keys to .env and restart CleanSpot.' });
const normaliseCategory = (category) => {
  const allowed = ['Plastic', 'Paper/Cardboard', 'Glass', 'Metal', 'Organic', 'Electronic', 'Construction', 'Mixed Waste', 'Other'];
  return allowed.includes(category) ? category : null;
};

function getBearerToken(request) {
  const authorization = request.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
}

async function profileForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function requireAuth(allowedRoles = []) {
  return async (request, response, next) => {
    if (!isSupabaseConfigured) return unavailable(response);
    try {
      const { user, error } = await getUserFromToken(getBearerToken(request));
      if (error || !user) return response.status(401).json({ error: 'Please sign in to continue.' });
      const profile = await profileForUser(user.id);
      if (!profile) return response.status(403).json({ error: 'Finish setting up your CleanSpot profile first.' });
      if (allowedRoles.length && !allowedRoles.includes(profile.role)) return response.status(403).json({ error: 'Your CleanSpot role cannot perform this action.' });
      request.user = user;
      request.profile = profile;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

async function requireUserOnly(request, response, next) {
  if (!isSupabaseConfigured) return unavailable(response);
  const { user, error } = await getUserFromToken(getBearerToken(request));
  if (error || !user) return response.status(401).json({ error: 'Please sign in to continue.' });
  request.user = user;
  return next();
}

function distanceInMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  if ([latitudeA, longitudeA, latitudeB, longitudeB].some((value) => typeof value !== 'number')) return Infinity;
  const radians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const latitudeDistance = radians(latitudeB - latitudeA);
  const longitudeDistance = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDistance / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDistance / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function similarWasteCategory(one, two) {
  if (!one || !two) return false;
  return one === two || one === 'Mixed Waste' || two === 'Mixed Waste';
}

async function findActiveDuplicate({ latitude, longitude, category }) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const { data, error } = await supabaseAdmin
    .from('reports')
    .select('id, latitude, longitude, waste_category')
    .in('status', activeStatuses)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  if (error) throw error;
  return data.find((report) => similarWasteCategory(report.waste_category, category)
    && distanceInMeters(latitude, longitude, Number(report.latitude), Number(report.longitude)) <= 125) || null;
}

async function uploadImage(file, bucket, userId) {
  if (!file) return null;
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) throw new Error('Only JPG, PNG, WEBP, HEIC, and HEIF images are accepted.');
  const extension = file.originalname.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
  const filePath = `${userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabaseAdmin.storage.from(bucket).upload(filePath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw new Error(`Image upload failed: ${error.message}`);
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

async function writeStatusHistory(reportId, status, changedBy) {
  const { error } = await supabaseAdmin.from('report_status_history').insert({
    report_id: reportId,
    status,
    changed_by: changedBy,
  });
  if (error) throw error;
}

async function getCleanupCompany(userId) {
  const profile = await profileForUser(userId);
  if (!profile) return null;
  const { data, error } = await supabaseAdmin
    .from('cleanup_companies')
    .select('*')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, supabaseConfigured: isSupabaseConfigured, aiConfigured: Boolean(process.env.HACKCLUB_API_KEY) });
});

app.get('/api/public-config', (_request, response) => response.json(publicSupabaseConfig));

app.post('/api/onboarding', requireUserOnly, async (request, response, next) => {
  try {
    const payload = z.object({
      name: z.string().trim().min(2).max(80),
      // Admin access is provisioned manually by a trusted operator, never selected at signup.
      role: z.enum(['citizen', 'cleanup_company']),
      companyName: z.string().trim().max(120).optional(),
      serviceArea: z.string().trim().max(160).optional(),
    }).parse(request.body);

    if (payload.role === 'cleanup_company' && !payload.companyName) {
      return badRequest(response, 'Cleanup companies need a company name.');
    }

    const profileInput = {
      user_id: request.user.id,
      name: payload.name,
      email: request.user.email || '',
      role: payload.role,
    };
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(profileInput, { onConflict: 'user_id' })
      .select()
      .single();
    if (profileError) throw profileError;

    if (payload.role === 'cleanup_company') {
      const { error: companyError } = await supabaseAdmin.from('cleanup_companies').upsert({
        profile_id: profile.id,
        company_name: payload.companyName,
        service_area: payload.serviceArea || 'Sri Lanka',
      }, { onConflict: 'profile_id' });
      if (companyError) throw companyError;
    }

    if (payload.role === 'citizen') {
      const { data: existingListings, error: listingReadError } = await supabaseAdmin
        .from('marketplace_listings')
        .select('id')
        .limit(1);
      if (listingReadError) throw listingReadError;
      if (!existingListings?.length) {
        const { error: seedError } = await supabaseAdmin.from('marketplace_listings').insert(
          starterMarketplaceListings.map((listing) => ({
            ...listing,
            seller_id: profile.id,
            contact_info: request.user.email || 'Contact through CleanSpot',
          })),
        );
        if (seedError) throw seedError;
      }
    }

    response.status(201).json({ profile });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', requireAuth(), async (request, response, next) => {
  try {
    const company = request.profile.role === 'cleanup_company' ? await getCleanupCompany(request.user.id) : null;
    response.json({ profile: request.profile, company });
  } catch (error) {
    next(error);
  }
});

app.put('/api/me', requireAuth(), async (request, response, next) => {
  try {
    const payload = z.object({ name: z.string().trim().min(2).max(80) }).parse(request.body);
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update({ name: payload.name })
      .eq('id', request.profile.id)
      .select()
      .single();
    if (error) throw error;
    response.json({ profile: data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', requireAuth(), async (request, response, next) => {
  try {
    const [reportsResult, listingsResult, activityResult, claimsResult] = await Promise.all([
      supabaseAdmin.from('reports').select('id,status,description,location,created_at,updated_at,ai_analysis(waste_type,severity,priority,estimated_scale)').eq('user_id', request.user.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('marketplace_listings').select('id').eq('seller_id', request.profile.id).eq('active', true),
      supabaseAdmin.from('points_transactions').select('id,points,type,created_at,report_id').eq('user_id', request.user.id).order('created_at', { ascending: false }).limit(5),
      supabaseAdmin.from('reward_claims').select('id,status,created_at,rewards(name)').eq('user_id', request.user.id).order('created_at', { ascending: false }).limit(3),
    ]);
    [reportsResult, listingsResult, activityResult, claimsResult].forEach((result) => { if (result.error) throw result.error; });
    const reports = reportsResult.data || [];
    response.json({
      profile: request.profile,
      stats: {
        reports: reports.length,
        cleaned: reports.filter((report) => report.status === 'cleaned').length,
        listings: listingsResult.data?.length || 0,
        points: request.profile.points,
      },
      reports: reports.slice(0, 5),
      activity: activityResult.data || [],
      claims: claimsResult.data || [],
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/analyze-waste', requireAuth(['citizen']), async (request, response, next) => {
  try {
    const payload = z.object({
      description: z.string().trim().min(8).max(1000),
      wasteCategory: z.string().optional(),
      location: z.string().trim().min(2).max(250),
      imageUrl: z.string().url().optional(),
    }).parse(request.body);
    const result = await analyzeWaste({
      description: payload.description,
      userCategory: normaliseCategory(payload.wasteCategory),
      location: payload.location,
      imageUrl: payload.imageUrl,
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/reports', requireAuth(['citizen']), upload.array('photos', 4), async (request, response, next) => {
  try {
    const description = String(request.body.description || '').trim();
    const location = String(request.body.location || '').trim();
    const userCategory = normaliseCategory(request.body.wasteCategory);
    const latitude = request.body.latitude === '' || request.body.latitude === undefined ? null : Number(request.body.latitude);
    const longitude = request.body.longitude === '' || request.body.longitude === undefined ? null : Number(request.body.longitude);
    if (description.length < 8 || description.length > 1000) return badRequest(response, 'Describe the waste in 8 to 1,000 characters.');
    if (location.length < 2 || location.length > 250) return badRequest(response, 'Add a clear location or nearby landmark.');
    if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) return badRequest(response, 'The location coordinates are invalid.');
    if (!request.files?.length) return badRequest(response, 'Add at least one waste photo.');

    const photoUrls = await Promise.all(request.files.map((file) => uploadImage(file, 'report-photos', request.user.id)));
    const aiResult = await analyzeWaste({ description, userCategory, location, imageUrl: photoUrls[0] });
    const category = userCategory || aiResult.analysis.waste_type;
    const duplicate = await findActiveDuplicate({ latitude, longitude, category });
    const status = duplicate ? 'declined' : 'pending';
    const { data: report, error: reportError } = await supabaseAdmin.from('reports').insert({
      user_id: request.user.id,
      photo_url: photoUrls[0],
      photo_urls: photoUrls,
      description,
      location,
      latitude,
      longitude,
      waste_category: category,
      status,
      decline_reason: duplicate ? 'Duplicate report already exists for this location and issue.' : null,
      duplicate_of_report_id: duplicate?.id || null,
    }).select().single();
    if (reportError) throw reportError;

    const { error: analysisError } = await supabaseAdmin.from('ai_analysis').insert({
      report_id: report.id,
      ...aiResult.analysis,
      source: aiResult.source,
      raw_response: aiResult.rawResponse || null,
    });
    if (analysisError) throw analysisError;
    await writeStatusHistory(report.id, status, request.user.id);

    response.status(201).json({
      report,
      analysis: aiResult.analysis,
      analysisSource: aiResult.source,
      analysisNote: aiResult.note,
      duplicate: Boolean(duplicate),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/reports/mine', requireAuth(['citizen']), async (request, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('reports')
      .select('*, ai_analysis(*)')
      .eq('user_id', request.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    response.json({ reports: data || [] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/company/reports', requireAuth(['cleanup_company']), async (request, response, next) => {
  try {
    const company = await getCleanupCompany(request.user.id);
    if (!company) return badRequest(response, 'Set up your cleanup company profile first.');
    const { data, error } = await supabaseAdmin
      .from('reports')
      .select('*, ai_analysis(*)')
      .in('status', ['pending', 'accepted', 'assigned', 'cleaning'])
      .or(`cleanup_company_id.is.null,cleanup_company_id.eq.${company.id}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const reporterIds = [...new Set((data || []).map((report) => report.user_id))];
    const { data: reporterProfiles, error: reporterError } = reporterIds.length
      ? await supabaseAdmin.from('profiles').select('user_id,name').in('user_id', reporterIds)
      : { data: [], error: null };
    if (reporterError) throw reporterError;
    const reporterByUserId = new Map((reporterProfiles || []).map((profile) => [profile.user_id, profile]));
    const reports = (data || []).map((report) => ({ ...report, reporter: reporterByUserId.get(report.user_id) || null }));
    response.json({ company, reports });
  } catch (error) {
    next(error);
  }
});

app.post('/api/company/reports/:reportId/accept', requireAuth(['cleanup_company']), async (request, response, next) => {
  try {
    const company = await getCleanupCompany(request.user.id);
    const { data, error } = await supabaseAdmin
      .from('reports')
      .update({ status: 'accepted', cleanup_company_id: company.id })
      .eq('id', request.params.reportId)
      .eq('status', 'pending')
      .is('cleanup_company_id', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest(response, 'This report is no longer available.');
    await writeStatusHistory(data.id, 'accepted', request.user.id);
    response.json({ report: data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/company/reports/:reportId/decline', requireAuth(['cleanup_company']), async (request, response, next) => {
  try {
    const reason = String(request.body.reason || '').trim();
    if (reason.length < 3 || reason.length > 300) return badRequest(response, 'Give a clear decline reason.');
    const company = await getCleanupCompany(request.user.id);
    const { data, error } = await supabaseAdmin
      .from('reports')
      .update({ status: 'declined', decline_reason: reason, cleanup_company_id: company.id })
      .eq('id', request.params.reportId)
      .eq('status', 'pending')
      .is('cleanup_company_id', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return badRequest(response, 'This report is no longer available.');
    await writeStatusHistory(data.id, 'declined', request.user.id);
    response.json({ report: data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/company/reports/:reportId/status', requireAuth(['cleanup_company']), async (request, response, next) => {
  try {
    const nextStatus = String(request.body.status || '');
    if (!['assigned', 'cleaning'].includes(nextStatus)) return badRequest(response, 'Unsupported cleanup status.');
    const company = await getCleanupCompany(request.user.id);
    const { data: current, error: currentError } = await supabaseAdmin
      .from('reports')
      .select('id,status,cleanup_company_id')
      .eq('id', request.params.reportId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current || current.cleanup_company_id !== company.id) return response.status(403).json({ error: 'This report is not assigned to your company.' });
    const transitions = { accepted: ['assigned', 'cleaning'], assigned: ['cleaning'], cleaning: [] };
    if (!transitions[current.status]?.includes(nextStatus)) return badRequest(response, 'That status change is not allowed.');
    const { data, error } = await supabaseAdmin.from('reports')
      .update({ status: nextStatus })
      .eq('id', current.id)
      .select()
      .single();
    if (error) throw error;
    await writeStatusHistory(data.id, nextStatus, request.user.id);
    response.json({ report: data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/company/reports/:reportId/complete', requireAuth(['cleanup_company']), upload.single('proofPhoto'), async (request, response, next) => {
  try {
    if (!request.file) return badRequest(response, 'Upload an after-cleaning proof photo first.');
    const proofUrl = await uploadImage(request.file, 'cleanup-proof-photos', request.user.id);
    const { data, error } = await supabaseAdmin.rpc('complete_report_with_points', {
      p_report_id: request.params.reportId,
      p_company_user_id: request.user.id,
      p_proof_photo_url: proofUrl,
    });
    if (error) return badRequest(response, error.message);
    response.json({ result: data, proofUrl });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rewards', requireAuth(), async (_request, response, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('rewards').select('*').eq('active', true).order('points_cost');
    if (error) throw error;
    response.json({ rewards: data || [] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/rewards/claims', requireAuth(), async (request, response, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('reward_claims')
      .select('*, rewards(name,description,image_url,points_cost)')
      .eq('user_id', request.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    response.json({ claims: data || [] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/rewards/:rewardId/claim', requireAuth(['citizen']), async (request, response, next) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('claim_reward', {
      p_reward_id: request.params.rewardId,
      p_user_id: request.user.id,
    });
    if (error) return badRequest(response, error.message);
    const profile = await profileForUser(request.user.id);
    response.json({ claim: data, points: profile.points });
  } catch (error) {
    next(error);
  }
});

app.get('/api/marketplace', requireAuth(), async (request, response, next) => {
  try {
    const query = String(request.query.q || '').trim();
    const category = String(request.query.category || '').trim();
    const listingType = String(request.query.listingType || '').trim();
    let requestBuilder = supabaseAdmin
      .from('marketplace_listings')
      .select('*, profiles!marketplace_listings_seller_id_fkey(name)')
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (query) requestBuilder = requestBuilder.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
    if (category) requestBuilder = requestBuilder.eq('category', category);
    if (listingType) requestBuilder = requestBuilder.eq('listing_type', listingType);
    const { data, error } = await requestBuilder;
    if (error) throw error;
    response.json({ listings: data || [] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/marketplace', requireAuth(['citizen']), upload.array('photos', 4), async (request, response, next) => {
  try {
    const payload = z.object({
      title: z.string().trim().min(3).max(120),
      description: z.string().trim().min(8).max(1000),
      category: z.enum(['Cardboard', 'Plastic', 'Glass', 'Metal', 'Electronics', 'Furniture', 'Reusable Items', 'Other']),
      quantity: z.string().trim().min(1).max(100),
      listingType: z.enum(['individual', 'bulk']),
      condition: z.string().trim().min(2).max(80),
      price: z.coerce.number().min(0).max(10000000),
      location: z.string().trim().min(2).max(250),
      contactInfo: z.string().trim().min(3).max(160),
    }).parse(request.body);
    if (!request.files?.length) return badRequest(response, 'Add at least one listing photo.');
    const imageUrls = await Promise.all(request.files.map((file) => uploadImage(file, 'marketplace-photos', request.user.id)));
    const { data, error } = await supabaseAdmin.from('marketplace_listings').insert({
      seller_id: request.profile.id,
      title: payload.title,
      description: payload.description,
      category: payload.category,
      quantity: payload.quantity,
      listing_type: payload.listingType,
      condition: payload.condition,
      price: payload.price,
      location: payload.location,
      contact_info: payload.contactInfo,
      image_urls: imageUrls,
    }).select().single();
    if (error) throw error;
    response.status(201).json({ listing: data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/overview', requireAuth(['admin']), async (_request, response, next) => {
  try {
    const [reports, users, rewards] = await Promise.all([
      supabaseAdmin.from('reports').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('reward_claims').select('id', { count: 'exact', head: true }),
    ]);
    [reports, users, rewards].forEach((result) => { if (result.error) throw result.error; });
    response.json({ reports: reports.count, users: users.count, claims: rewards.count });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  if (error instanceof z.ZodError) return response.status(400).json({ error: error.issues[0]?.message || 'Please check the form fields.' });
  if (error instanceof multer.MulterError) return response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Images must be 6 MB or smaller.' : 'Image upload could not be completed.' });
  return response.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const server = app.listen(port, () => {
  console.log(`CleanSpot is running at http://localhost:${port}`);
});

server.on('error', (error) => {
  console.error('CleanSpot server failed to start:', error.message);
  process.exitCode = 1;
});

export { app, server };
