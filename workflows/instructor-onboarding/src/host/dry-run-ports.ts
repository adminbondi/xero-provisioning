import type { Ports } from "../ports.ts";

function blocked(name: string): Promise<never> {
  return Promise.reject(new Error(`DRY_RUN blocked ${name}`));
}

/** Ports used while DRY_RUN is on. Every method fails closed. The steps do not call them. */
export function dryRunPorts(): Ports {
  return {
    airtable: { listRecords: () => blocked("airtable.listRecords") },
    employees: {
      listPayrollCalendars: () => blocked("employees.listPayrollCalendars"),
      findEmployeesByEmail: () => blocked("employees.findEmployeesByEmail"),
      findEmployeesByName: () => blocked("employees.findEmployeesByName"),
      createEmployee: () => blocked("employees.createEmployee"),
      getEmployee: () => blocked("employees.getEmployee"),
      updatePayTemplate: () => blocked("employees.updatePayTemplate"),
    },
    contacts: {
      findContactByNumber: () => blocked("contacts.findContactByNumber"),
      findContactsByEmail: () => blocked("contacts.findContactsByEmail"),
      findContactsByName: () => blocked("contacts.findContactsByName"),
      upsertContact: () => blocked("contacts.upsertContact"),
      getContact: () => blocked("contacts.getContact"),
    },
    slack: { postMessage: () => blocked("slack.postMessage") },
    email: { send: () => blocked("email.send") },
  };
}
