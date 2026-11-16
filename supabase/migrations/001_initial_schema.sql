-- =============================================================================
-- TERRA: Modular Event Management & Ticket Marketplace
-- Initial PostgreSQL Schema, Constraints, RLS Policies, & Atomic RPC Functions
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. AUTHENTICATION, USERS & ORGANIZATIONS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  username TEXT UNIQUE,
  avatar_url TEXT,
  phone TEXT,
  bio TEXT,
  system_role TEXT NOT NULL DEFAULT 'customer' CHECK (system_role IN ('customer', 'organizer', 'admin')),
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_url TEXT,
  cover_url TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 2. EVENT CORE & MODULAR CONFIGURATION
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  category_id UUID REFERENCES event_categories(id) ON DELETE SET NULL,
  poster_url TEXT,
  banner_url TEXT,
  location_type TEXT NOT NULL DEFAULT 'offline' CHECK (location_type IN ('online', 'offline', 'hybrid')),
  location_name TEXT,
  address TEXT,
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  online_url TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Preparation', 'Published', 'Ongoing', 'Completed', 'Cancelled')),
  publication_status TEXT NOT NULL DEFAULT 'Unpublished' CHECK (publication_status IN ('Unpublished', 'Pending Review', 'Approved', 'Rejected', 'Published', 'Suspended')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
  is_featured BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_core BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS event_module_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES event_modules(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, module_id)
);

CREATE TABLE IF NOT EXISTS event_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  department TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS event_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  UNIQUE (event_id, user_id, permission_id)
);

-- -----------------------------------------------------------------------------
-- 3. PROJECT TIMELINE & HIERARCHICAL TASKS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location TEXT,
  responsible_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'internal')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES event_tasks(id) ON DELETE CASCADE,
  is_group BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  description TEXT,
  phase TEXT NOT NULL DEFAULT 'Production',
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
  status TEXT NOT NULL DEFAULT 'To Do' CHECK (status IN ('To Do', 'In Progress', 'Review', 'Done', 'Cancelled')),
  start_date DATE,
  due_at DATE,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES event_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES event_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. TICKETING, ORDERS, PARTICIPANTS & CHECK-IN
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0 AND sold_quantity <= quantity),
  sale_start_at TIMESTAMPTZ,
  sale_end_at TIMESTAMPTZ,
  min_per_order INTEGER NOT NULL DEFAULT 1 CHECK (min_per_order >= 1),
  max_per_order INTEGER NOT NULL DEFAULT 5 CHECK (max_per_order >= min_per_order),
  status TEXT NOT NULL DEFAULT 'On Sale' CHECK (status IN ('Draft', 'Scheduled', 'On Sale', 'Sold Out', 'Sales Ended', 'Disabled')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  order_status TEXT NOT NULL DEFAULT 'Pending' CHECK (order_status IN ('Pending', 'Confirmed', 'Cancelled', 'Completed')),
  payment_status TEXT NOT NULL DEFAULT 'Not Required' CHECK (payment_status IN ('Not Required', 'Pending', 'Paid', 'Failed', 'Refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0)
);

CREATE TABLE IF NOT EXISTS attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  registration_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  registration_status TEXT NOT NULL DEFAULT 'Confirmed' CHECK (registration_status IN ('Pending', 'Confirmed', 'Cancelled', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
  attendee_id UUID NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  ticket_type_id UUID NOT NULL REFERENCES ticket_types(id) ON DELETE RESTRICT,
  ticket_code TEXT NOT NULL UNIQUE,
  qr_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Used', 'Cancelled', 'Expired')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ticket_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  checked_in_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  checkin_location TEXT NOT NULL DEFAULT 'Gate A - Main Lobby',
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. FINANCE, VENDOR, SPONSOR, DOCUMENTS & FEEDBACK
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled'))
);

CREATE TABLE IF NOT EXISTS event_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event_income_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR',
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT,
  category TEXT NOT NULL,
  contribution TEXT,
  benefits TEXT,
  contact_details TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Cancelled'))
);

CREATE TABLE IF NOT EXISTS event_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES event_surveys(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'text', 'rating')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES event_surveys(id) ON DELETE CASCADE,
  attendee_id UUID REFERENCES attendees(id) ON DELETE SET NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. MARKETPLACE, MODERATION & AUDIT LOGS
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizer_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  submitted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_notes TEXT,
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_moderation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  reference_type TEXT,
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 7. INDEXES FOR PERFORMANCE
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_events_org ON events(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_pub_status ON events(publication_status, status);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_event_tasks_event_parent ON event_tasks(event_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_ticket_types_event ON ticket_types(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_qr_hash ON tickets(qr_token_hash);

-- -----------------------------------------------------------------------------
-- 8. ATOMIC RPC FUNCTIONS (PREVENT RACE CONDITIONS & DOUBLE CHECK-IN)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_ticket_order(
  p_event_id UUID,
  p_customer_id UUID,
  p_ticket_type_id UUID,
  p_quantity INTEGER,
  p_full_name TEXT,
  p_email TEXT,
  p_phone TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event RECORD;
  v_ticket_type RECORD;
  v_order_id UUID;
  v_order_item_id UUID;
  v_attendee_id UUID;
  v_order_number TEXT;
  v_subtotal NUMERIC(14, 2);
  v_order_status TEXT;
  v_payment_status TEXT;
  v_ticket_status TEXT;
  v_i INTEGER;
  v_code TEXT;
  v_qr_hash TEXT;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_event.status = 'Cancelled' THEN
    RAISE EXCEPTION 'EVENT_UNAVAILABLE';
  END IF;

  -- Lock row FOR UPDATE to prevent race conditions
  SELECT * INTO v_ticket_type
  FROM ticket_types
  WHERE id = p_ticket_type_id AND event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_ticket_type.status NOT IN ('On Sale') THEN
    RAISE EXCEPTION 'TICKET_UNAVAILABLE';
  END IF;

  IF (v_ticket_type.quantity - v_ticket_type.sold_quantity) < p_quantity THEN
    RAISE EXCEPTION 'TICKET_SOLD_OUT';
  END IF;

  v_subtotal := v_ticket_type.price * p_quantity;
  v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6));

  IF v_ticket_type.price = 0 THEN
    v_order_status := 'Confirmed';
    v_payment_status := 'Not Required';
    v_ticket_status := 'Active';
  ELSE
    -- Paid tickets remain Pending until verified/paid
    v_order_status := 'Pending';
    v_payment_status := 'Pending';
    v_ticket_status := 'Cancelled';
  END IF;

  UPDATE ticket_types
  SET sold_quantity = sold_quantity + p_quantity,
      status = CASE WHEN (sold_quantity + p_quantity) >= quantity THEN 'Sold Out' ELSE status END
  WHERE id = p_ticket_type_id;

  INSERT INTO orders (order_number, event_id, customer_id, subtotal, total, currency, order_status, payment_status)
  VALUES (v_order_number, p_event_id, p_customer_id, v_subtotal, v_subtotal, v_ticket_type.currency, v_order_status, v_payment_status)
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, ticket_type_id, quantity, unit_price, subtotal)
  VALUES (v_order_id, p_ticket_type_id, p_quantity, v_ticket_type.price, v_subtotal)
  RETURNING id INTO v_order_item_id;

  INSERT INTO attendees (event_id, order_id, user_id, full_name, email, phone, registration_status)
  VALUES (p_event_id, v_order_id, p_customer_id, p_full_name, p_email, p_phone, CASE WHEN v_order_status = 'Confirmed' THEN 'Confirmed' ELSE 'Pending' END)
  RETURNING id INTO v_attendee_id;

  IF v_order_status = 'Confirmed' THEN
    FOR v_i IN 1..p_quantity LOOP
      v_code := 'EVT-' || UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 8));
      v_qr_hash := encode(digest(gen_random_uuid()::TEXT, 'sha256'), 'hex');
      INSERT INTO tickets (event_id, order_id, order_item_id, attendee_id, ticket_type_id, ticket_code, qr_token_hash, status)
      VALUES (p_event_id, v_order_id, v_order_item_id, v_attendee_id, p_ticket_type_id, v_code, v_qr_hash, v_ticket_status);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'order_status', v_order_status,
    'payment_status', v_payment_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION checkin_ticket(
  p_qr_token_hash TEXT,
  p_checked_in_by UUID,
  p_station TEXT DEFAULT 'Gate A - Main Lobby'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket RECORD;
BEGIN
  SELECT * INTO v_ticket
  FROM tickets
  WHERE qr_token_hash = p_qr_token_hash OR ticket_code = p_qr_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TICKET_NOT_FOUND';
  END IF;

  IF v_ticket.status = 'Used' THEN
    RAISE EXCEPTION 'TICKET_ALREADY_USED';
  END IF;

  IF v_ticket.status <> 'Active' THEN
    RAISE EXCEPTION 'TICKET_NOT_ACTIVE';
  END IF;

  UPDATE tickets
  SET status = 'Used', used_at = NOW()
  WHERE id = v_ticket.id;

  INSERT INTO ticket_checkins (ticket_id, event_id, checked_in_by, checkin_location)
  VALUES (v_ticket.id, v_ticket.event_id, p_checked_in_by, p_station);

  RETURN jsonb_build_object(
    'ticket_id', v_ticket.id,
    'ticket_code', v_ticket.ticket_code,
    'checked_in_at', NOW(),
    'station', p_station
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY (RLS)
-- -----------------------------------------------------------------------------

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_module_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_income_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles: self read/update" ON profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "Marketplace: public read published events" ON events
  FOR SELECT USING (publication_status = 'Published' AND visibility = 'public' AND deleted_at IS NULL);

CREATE POLICY "Org members: isolate organization events" ON events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = events.organization_id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
    )
  );

CREATE POLICY "Customer: read own orders" ON orders
  FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY "Customer: read own tickets" ON tickets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = tickets.order_id AND o.customer_id = auth.uid()
    )
  );
