"use client";

import { useState } from "react";
import { useSettingsStore } from "@/lib/sales-crm/settings-store";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import { Role } from "@/lib/sales-crm/types";
import styles from "@/styles/sales-crm/settings.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

type ProfileTab = "my-profile" | "company-profile" | "my-password";

export default function ProfileSettings() {
  const { user: authUser } = useAuth();
  const { state, updateCompanyProfile, updateUserProfile, addAuditLog } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<ProfileTab>("my-profile");
  const [companyForm, setCompanyForm] = useState(
    state.companyProfile || {
      company_name: "",
      company_address: "",
      timezone: "",
      currency: "",
      contact_details: "",
    }
  );
  const [userForm, setUserForm] = useState(
    state.userProfile || {
      name: "",
      phone: "",
      email: "",
      profile_photo: "",
      timezone: "",
      date_format: "",
      language: "",
      address: "",
      work_details: "",
      location_details: "",
    }
  );

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const isAdmin = authUser?.role === Role.SUPERADMIN || authUser?.role === Role.ADMIN;
  const actorName = authUser?.name || "System";
  const actorId = authUser?.id || "system";

  const handleSaveCompany = (e: React.FormEvent) => {
    e.preventDefault();
    updateCompanyProfile(companyForm, actorName, actorId);
    setSuccessMessage("Company Profile saved successfully.");
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    updateUserProfile(userForm, actorName, actorId);
    setSuccessMessage("User Profile saved successfully.");
    setTimeout(() => setSuccessMessage(""), 3000);
  };

  const handlePasswordSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setPasswordError("Current password is required.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters long.");
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setPasswordError("New password must contain at least one uppercase letter.");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setPasswordError("New password must contain at least one number.");
      return;
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
      setPasswordError("New password must contain at least one special character.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setPasswordError("");
    addAuditLog("password_update", actorName, actorId, "Password changed successfully");
    setSuccessMessage("Password updated successfully.");
    setTimeout(() => setSuccessMessage(""), 3000);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  // Compute password score (0-4)
  let pwScore = 0;
  if (newPassword.length >= 8) pwScore++;
  if (/[A-Z]/.test(newPassword)) pwScore++;
  if (/[0-9]/.test(newPassword)) pwScore++;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) pwScore++;

  return (
    <div className={`${styles["settings-section"]} ${ui["ui-card"]}`}>
      <div className={`${ui["ui-card-header"]} ${styles["settings-profile-header"]}`}>
        <h2 className={ui["ui-card-title"]}>Profile Settings</h2>
        {successMessage && <div className={styles["settings-save-indicator"]}>{successMessage}</div>}
      </div>

      <div className={`${ui["ui-card-body"]} ${styles["settings-profile-layout"]}`}>
        {/* Sub-Navigation */}
        <nav className={styles["settings-profile-nav"]}>
          <button
            className={`${styles["settings-profile-nav-item"]} ${activeTab === "my-profile" ? styles["settings-profile-nav-item-active"] : ""}`}
            onClick={() => setActiveTab("my-profile")}
          >
            <span className={styles["settings-profile-nav-icon"]}>P</span>
            <div className={styles["settings-profile-nav-text"]}>
              <span className={styles["settings-profile-nav-label"]}>My Profile</span>
              <span className={styles["settings-profile-nav-desc"]}>Personal information</span>
            </div>
          </button>

          {isAdmin && (
            <button
              className={`${styles["settings-profile-nav-item"]} ${activeTab === "company-profile" ? styles["settings-profile-nav-item-active"] : ""}`}
              onClick={() => setActiveTab("company-profile")}
            >
              <span className={styles["settings-profile-nav-icon"]}>C</span>
              <div className={styles["settings-profile-nav-text"]}>
                <span className={styles["settings-profile-nav-label"]}>Company Profile</span>
                <span className={styles["settings-profile-nav-desc"]}>Business details</span>
              </div>
            </button>
          )}

          <button
            className={`${styles["settings-profile-nav-item"]} ${activeTab === "my-password" ? styles["settings-profile-nav-item-active"] : ""}`}
            onClick={() => setActiveTab("my-password")}
          >
            <span className={styles["settings-profile-nav-icon"]}>S</span>
            <div className={styles["settings-profile-nav-text"]}>
              <span className={styles["settings-profile-nav-label"]}>My Password</span>
              <span className={styles["settings-profile-nav-desc"]}>Security settings</span>
            </div>
          </button>
        </nav>

        {/* Content Area */}
        <div className={styles["settings-profile-content"]}>
          {activeTab === "my-profile" && (
            <form onSubmit={handleSaveUser} className="ui-form">
              <div className={`${styles["settings-form-section-group"]} ${styles["settings-form-section-first"]}`}>
                <h3 className={styles["settings-form-section-group-title"]}>Update your personal information</h3>
                <div className={ui["ui-form-group"]}>
                  <label className={ui["ui-label"]}>Profile Photo</label>
                  <div className={styles["settings-profile-photo-row"]}>
                    <div className={styles["settings-profile-avatar-lg"]}>{userForm.name?.charAt(0) || "U"}</div>
                    <div className={styles["settings-profile-photo-input"]}>
                      <input
                        className={ui["ui-input"]}
                        placeholder="https://image-url..."
                        value={userForm.profile_photo}
                        onChange={(e) => setUserForm({ ...userForm, profile_photo: e.target.value })}
                      />
                      <p className={styles["settings-form-help-text"]}>Provide a URL to update your profile photo.</p>
                    </div>
                  </div>
                </div>

                <div className={styles["settings-form-grid-2"]}>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Name</label>
                    <input className={ui["ui-input"]} value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required />
                  </div>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Phone Number</label>
                    <input className={ui["ui-input"]} value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} />
                  </div>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Email</label>
                    <input className={ui["ui-input"]} type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
                  </div>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Time Zone</label>
                    <input className={ui["ui-input"]} value={userForm.timezone} onChange={(e) => setUserForm({ ...userForm, timezone: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className={styles["settings-form-section-group"]}>
                <h3 className={styles["settings-form-section-group-title"]}>Preferences</h3>
                <div className={styles["settings-form-grid-2"]}>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Date Format</label>
                    <input className={ui["ui-input"]} value={userForm.date_format} onChange={(e) => setUserForm({ ...userForm, date_format: e.target.value })} />
                  </div>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Language</label>
                    <input className={ui["ui-input"]} value={userForm.language} onChange={(e) => setUserForm({ ...userForm, language: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className={styles["settings-form-section-group"]}>
                <h3 className={styles["settings-form-section-group-title"]}>Work & Location</h3>
                <div className={ui["ui-form-group"]}>
                  <label className={ui["ui-label"]}>Address</label>
                  <input className={ui["ui-input"]} value={userForm.address} onChange={(e) => setUserForm({ ...userForm, address: e.target.value })} />
                </div>
                <div className={styles["settings-form-grid-2"]}>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Work Details</label>
                    <input className={ui["ui-input"]} value={userForm.work_details} onChange={(e) => setUserForm({ ...userForm, work_details: e.target.value })} />
                  </div>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Location Details</label>
                    <input className={ui["ui-input"]} value={userForm.location_details} onChange={(e) => setUserForm({ ...userForm, location_details: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="ui-form-actions">
                <button type="submit" className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`}>
                  Save Profile
                </button>
              </div>
            </form>
          )}

          {activeTab === "company-profile" && isAdmin && (
            <form onSubmit={handleSaveCompany} className="ui-form">
              <div className={`${styles["settings-form-section-group"]} ${styles["settings-form-section-first"]}`}>
                <div className={styles["settings-section-header-row"]}>
                  <div className={styles["settings-profile-avatar-company"]}>C</div>
                  <div>
                    <h3 className={`${styles["settings-section-title"]} ${styles["settings-m-0"]}`}>Company Information</h3>
                    <p className={styles["settings-form-help-text"]}>Manage global details for your organization</p>
                  </div>
                </div>

                <div className={styles["settings-form-grid-2"]}>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Company Name</label>
                    <input className={ui["ui-input"]} value={companyForm.company_name} onChange={(e) => setCompanyForm({ ...companyForm, company_name: e.target.value })} required />
                  </div>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Company Address</label>
                    <input className={ui["ui-input"]} value={companyForm.company_address} onChange={(e) => setCompanyForm({ ...companyForm, company_address: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className={styles["settings-form-section-group"]}>
                <h3 className={styles["settings-form-section-group-title"]}>Configuration</h3>
                <div className={styles["settings-form-grid-2"]}>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Time Zone</label>
                    <input className={ui["ui-input"]} value={companyForm.timezone} onChange={(e) => setCompanyForm({ ...companyForm, timezone: e.target.value })} />
                  </div>
                  <div className={ui["ui-form-group"]}>
                    <label className={ui["ui-label"]}>Currency</label>
                    <input className={ui["ui-input"]} value={companyForm.currency} onChange={(e) => setCompanyForm({ ...companyForm, currency: e.target.value })} />
                  </div>
                  <div className={`${ui["ui-form-group"]} ${styles["settings-grid-col-full"]}`}>
                    <label className={ui["ui-label"]}>Contact Details</label>
                    <input className={ui["ui-input"]} value={companyForm.contact_details} onChange={(e) => setCompanyForm({ ...companyForm, contact_details: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="ui-form-actions">
                <button type="submit" className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`}>
                  Save Company Profile
                </button>
              </div>
            </form>
          )}

          {activeTab === "my-password" && (
            <form onSubmit={handlePasswordSave} className={`ui-form ${styles["settings-password-container"]}`}>
              {passwordError && <div className={`${ui["ui-notice"]} ui-notice-danger settings-mb-4`}>{passwordError}</div>}

              <div className={`${styles["settings-form-section-group"]} ${styles["settings-form-section-first"]}`}>
                <h3 className={`${styles["settings-section-title"]} ${styles["settings-mb-8"]}`}>Change Password</h3>
                <p className={`${styles["settings-form-help-text"]} ${styles["settings-mb-24"]}`}>Ensure your account stays secure</p>

                <div className={ui["ui-form-group"]}>
                  <label className={ui["ui-label"]}>Current Password</label>
                  <input className={ui["ui-input"]} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                </div>
                <div className={ui["ui-form-group"]}>
                  <label className={ui["ui-label"]}>New Password</label>
                  <input className={ui["ui-input"]} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />

                  {newPassword && (
                    <div className={styles["settings-password-strength-bar"]}>
                      <div className={styles["settings-password-strength-fill"]} data-score={pwScore}></div>
                    </div>
                  )}

                  <div className={styles["settings-password-rules-chips"]}>
                    <span className={styles["settings-password-rule-chip"]} data-pass={newPassword.length >= 8}>
                      {newPassword.length >= 8 ? "OK" : "X"} Min 8 chars
                    </span>
                    <span className={styles["settings-password-rule-chip"]} data-pass={/[A-Z]/.test(newPassword)}>
                      {/[A-Z]/.test(newPassword) ? "OK" : "X"} Uppercase
                    </span>
                    <span className={styles["settings-password-rule-chip"]} data-pass={/[0-9]/.test(newPassword)}>
                      {/[0-9]/.test(newPassword) ? "OK" : "X"} Number
                    </span>
                    <span className={styles["settings-password-rule-chip"]} data-pass={/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)}>
                      {/[!@#$%^&*(),.?":{}|<>]/.test(newPassword) ? "OK" : "X"} Special Char
                    </span>
                  </div>
                </div>

                <div className={`${ui["ui-form-group"]} ${styles["settings-mt-24"]}`}>
                  <label className={ui["ui-label"]}>Confirm New Password</label>
                  <input className={ui["ui-input"]} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                </div>
              </div>

              <div className="ui-form-actions">
                <button type="submit" className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`}>
                  Update Password
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
